-- Reframe the reorder buffer as "target cover at arrival": the percent
-- of one lead time of sales to still have on the shelf when a PO lands.
--
-- Old: target = lead_demand × (1 + reorder_buffer_pct / 100)
--      (50 meant "land at 1.5 lead times")
-- New: target = lead_demand × (restock_cover_pct / 100)
--      (150 means 1.5 lead times, 100 = one full lead time, 75 = 0.75)
--
-- The stored value is set to 75 — the cover level chosen when this
-- reframing was requested ("land at 0.75 lead times of stock").

alter table purchasing_settings rename column reorder_buffer_pct to restock_cover_pct;
alter table purchasing_settings alter column restock_cover_pct set default 100;
update purchasing_settings set restock_cover_pct = 75 where id = 1;

drop view if exists purchasing_reorder_view;

create view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size,
    season_multipliers[extract(month from current_date)::int] as season_mult,
    1 + (coalesce(annual_growth_pct, 0) / 100.0) as growth_factor,
    coalesce(restock_cover_pct, 100) / 100.0 as cover_factor
    from purchasing_settings where id = 1
),
soonest_arrival as (
  select
    poi.product_id,
    min(greatest(po.eta_date - current_date, 0))::int as days_until_arrival
  from purchasing_order_items poi
  join purchasing_orders po on po.id = poi.order_id
  where po.status in ('ordered', 'in_transit')
    and po.eta_date is not null
    and (poi.qty_ordered - poi.qty_received) > 0
  group by poi.product_id
),
-- lead_demand: units that sell during one lead time at the current
-- month's scaled rate. restock_target: the stock we want left when the
-- PO lands — cover_factor lead-times of demand with the expected-fill
-- floor, capped at physical capacity for glass; the existing 3-month
-- target for hardware.
effective as (
  select
    p.id,
    d.lead_demand,
    case p.category
      when 'hardware'
        then greatest(
          50,
          3 * (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) * s.season_mult * s.growth_factor
        )
      else p.storage_capacity
    end::numeric as effective_capacity,
    case p.category
      when 'hardware'
        then greatest(
          50,
          3 * (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) * s.season_mult * s.growth_factor
        )
      else least(
        p.storage_capacity::numeric,
        greatest(s.expected_fill * p.storage_capacity, d.lead_demand * s.cover_factor)
      )
    end::numeric as restock_target
  from purchasing_products p
  cross join s
  cross join lateral (
    select (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0)
            * s.season_mult * s.growth_factor * s.lead_time_days) as lead_demand
  ) d
)
select
  p.id,
  p.category,
  p.sku,
  p.name,
  p.height,
  p.width,
  p.weight,
  e.effective_capacity::numeric as storage_capacity,
  p.unit_cost_landed,
  p.current_inventory,
  p.avg_monthly_sales_grs,
  p.avg_monthly_sales_rf,
  p.active,
  p.sort_order,
  coalesce(ib.inbound_qty, 0)::numeric as inbound,
  (p.current_inventory + coalesce(ib.inbound_qty, 0))::numeric as total_inventory,
  (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor)::numeric as daily_sales,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) > 0
      then (p.current_inventory
            / (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
    else null
  end::numeric as days_of_stock_left,
  -- The total-stock level at which a reorder should fire: target at
  -- arrival + lead-time demand (directly comparable to on hand + inbound;
  -- Perfect = reorder_point − total).
  (e.restock_target + e.lead_demand)::numeric as reorder_point,
  e.restock_target::numeric as restock_target,
  greatest(0, e.restock_target + e.lead_demand
    - (p.current_inventory + coalesce(ib.inbound_qty, 0)))::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  case p.category
    when 'hardware' then 0
    else (p.current_inventory - p.storage_capacity)
  end::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0 then
      case
        when p.category = 'hardware'
         and (p.current_inventory + coalesce(ib.inbound_qty, 0)) < 50
          then 'reorder'
        else 'no_sales_data'
      end
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and (p.current_inventory + coalesce(ib.inbound_qty, 0))
         < (e.restock_target + e.lead_demand)
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    when (p.current_inventory + coalesce(ib.inbound_qty, 0))
         < (e.restock_target + e.lead_demand)
      then 'reorder'
    else 'ok'
  end::text as sop_label,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) > 0
      then ((p.current_inventory + coalesce(ib.inbound_qty, 0))
            / (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
    else null
  end::numeric as days_of_stock_with_inbound,
  sa.days_until_arrival as days_until_next_arrival,
  case p.category
    when 'hardware' then
      ceil(greatest(0, e.restock_target + e.lead_demand
        - (p.current_inventory + coalesce(ib.inbound_qty, 0))))
    else
      purchasing_round_to_crate(
        greatest(0, e.restock_target + e.lead_demand
          - (p.current_inventory + coalesce(ib.inbound_qty, 0))),
        s.crate_size
      )
  end::numeric as suggested_qty,
  ceil(greatest(
    0,
    coalesce(sa.days_until_arrival, s.lead_time_days)
      * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0)
         * s.season_mult * s.growth_factor)
    - p.current_inventory
  ))::numeric as transfer_requirement
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id
left join soonest_arrival sa on sa.product_id = p.id
left join effective e on e.id = p.id;
