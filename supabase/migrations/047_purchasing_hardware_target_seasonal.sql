-- Scale the hardware 3-month target by seasonality + annual growth, so
-- the floor reflects current expected demand rate rather than the flat
-- 12-month average.
--
-- Before: target = max(50, 3 × monthly_raw)
-- After:  target = max(50, 3 × monthly_raw × season_mult × growth_factor)
--
-- Effect:
-- - High-volume hardware SKUs get larger targets in peak months and
--   smaller ones in slow months, matching the daily_sales rate.
-- - The 50-unit absolute floor still applies; no-sales SKUs stay at 50.
-- - Glass behavior is unchanged (capacity is a stored value, not derived).

drop view if exists purchasing_reorder_view;

create view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size,
    season_multipliers[extract(month from current_date)::int] as season_mult,
    1 + (coalesce(annual_growth_pct, 0) / 100.0) as growth_factor
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
-- For hardware: target = max(50, 3 × monthly × season × growth) — scaled
-- with the same season/growth multipliers that scale daily_sales, so
-- "3 months of cover" reflects the current rate not the yearly average.
-- For glass: target = stored storage_capacity, unchanged.
effective as (
  select
    p.id,
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
      else s.expected_fill * p.storage_capacity
    end::numeric as effective_fill_floor
  from purchasing_products p
  cross join s
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
  ((((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor) * s.lead_time_days)::numeric as reorder_point,
  greatest(
    0,
    e.effective_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
      + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
  )::numeric as perfect_qty,
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
     and (
           ((p.current_inventory + coalesce(ib.inbound_qty, 0))
              / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
              < (2 * s.lead_time_days)
        or (p.current_inventory + coalesce(ib.inbound_qty, 0))
              < e.effective_fill_floor
         )
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    when ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < (2 * s.lead_time_days)
     and (p.current_inventory + coalesce(ib.inbound_qty, 0))
         < (e.effective_capacity
            + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor)))
      then 'reorder'
    when (p.current_inventory + coalesce(ib.inbound_qty, 0))
         < e.effective_fill_floor
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
      ceil(greatest(
        0,
        e.effective_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
          + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
      ))
    else
      purchasing_round_to_crate(
        greatest(
          0,
          e.effective_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
            + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
        ),
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
