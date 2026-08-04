-- Demand-driven restock target (replaces "fill the shelf" for glass).
--
-- Before: glass aimed to land at full capacity when a PO arrives, and
-- reorder fired on (days-with-inbound < 2 lead times AND total <
-- capacity + lead-time demand) OR (total < expected_fill × capacity).
--
-- After: the stock we want left when a PO arrives is
--   restock_target = least(capacity,
--     greatest(expected_fill × capacity,
--              lead_time_demand × (1 + reorder_buffer_pct/100)))
-- where lead_time_demand = daily_sales × lead_time_days (what sells
-- while the order ships). Reorder fires when on hand + inbound <
-- restock_target + lead_time_demand — i.e. the moment ordering today
-- would no longer land you at the target. Perfect/Suggested aim at the
-- target instead of full capacity, so slow movers stop being topped up
-- to a full shelf they don't need.
--
-- Hardware keeps its derived target max(50, 3 × monthly × season ×
-- growth); the unified trigger (total < target + lead_time_demand)
-- replaces the old two-branch rule there too (numerically equivalent
-- for hardware since its target ≈ one lead time of demand).

alter table purchasing_settings
  add column if not exists reorder_buffer_pct numeric not null default 50;

drop view if exists purchasing_reorder_view;

create view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size,
    season_multipliers[extract(month from current_date)::int] as season_mult,
    1 + (coalesce(annual_growth_pct, 0) / 100.0) as growth_factor,
    1 + (coalesce(reorder_buffer_pct, 50) / 100.0) as buffer_factor
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
-- PO lands — demand-driven with the expected-fill floor, capped at
-- physical capacity for glass; the existing 3-month target for hardware.
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
        greatest(s.expected_fill * p.storage_capacity, d.lead_demand * s.buffer_factor)
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
  -- The total-stock level at which a reorder should fire. Was just
  -- lead-time demand; now target + lead-time demand so it's directly
  -- comparable to on hand + inbound (and Perfect = reorder_point − total).
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
