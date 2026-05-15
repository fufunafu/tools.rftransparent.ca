-- Re-wire `expected_fill` into the reorder trigger. Previously the
-- field was set-able in Settings but had no effect — migration 033
-- dropped it from the view's CTE.
--
-- New rule: needs_reorder fires when EITHER
--   1. days_of_stock_with_inbound < 2 × lead_time_days (time-based, as before)
--   2. total_inventory < expected_fill × storage_capacity (capacity-based, new)
--
-- The capacity-based half ensures slow-movers still trigger reorder
-- when inventory dips below the target warehouse fill, regardless of
-- how leisurely the sales rate is. Mirrors the Excel OVERVIEW logic
-- (column O: H < 0.7 × I + N).
--
-- Montreal trigger is unchanged.
--
-- Safe to re-run.

create or replace view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days
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
)
select
  p.id,
  p.category,
  p.sku,
  p.name,
  p.height,
  p.width,
  p.weight,
  p.storage_capacity,
  p.unit_cost_landed,
  p.current_inventory,
  p.avg_monthly_sales_grs,
  p.avg_monthly_sales_rf,
  p.active,
  p.sort_order,
  coalesce(ib.inbound_qty, 0)::numeric as inbound,
  (p.current_inventory + coalesce(ib.inbound_qty, 0))::numeric as total_inventory,
  ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0)::numeric as daily_sales,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) > 0
      then (p.current_inventory / ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0))
    else null
  end::numeric as days_of_stock_left,
  (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.lead_time_days)::numeric as reorder_point,
  greatest(
    0,
    p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
      + (s.lead_time_days * ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0))
  )::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  (p.current_inventory - p.storage_capacity)::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0
      then 'no_sales_data'
    -- needs_montreal AND needs_reorder
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and (
           -- needs_reorder = time-based OR capacity-based
           ((p.current_inventory + coalesce(ib.inbound_qty, 0))
              / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
              < (2 * s.lead_time_days)
        or (p.current_inventory + coalesce(ib.inbound_qty, 0))
              < (s.expected_fill * p.storage_capacity)
         )
      then 'reorder_plus_montreal'
    -- needs_montreal only
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    -- needs_reorder only
    when ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < (2 * s.lead_time_days)
      then 'reorder'
    when (p.current_inventory + coalesce(ib.inbound_qty, 0))
         < (s.expected_fill * p.storage_capacity)
      then 'reorder'
    else 'ok'
  end::text as sop_label,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) > 0
      then ((p.current_inventory + coalesce(ib.inbound_qty, 0))
            / ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0))
    else null
  end::numeric as days_of_stock_with_inbound,
  sa.days_until_arrival as days_until_next_arrival
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id
left join soonest_arrival sa on sa.product_id = p.id;
