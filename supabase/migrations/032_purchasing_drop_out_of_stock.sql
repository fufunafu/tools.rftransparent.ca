-- Remove the 'out_of_stock' status. From a Purchasing perspective the
-- required action when on_hand = 0 is identical to 'reorder_plus_montreal'
-- (or 'montreal_transfer' if inbound covers long-term cover): pull stock
-- from Montreal and/or place a new main-supplier order. Splitting it out
-- added noise without changing the workflow.
--
-- Rows with on_hand = 0 now fall into the existing case clauses:
--   - daily = 0           → no_sales_data
--   - has inbound coming  → montreal_transfer (or reorder_plus_montreal if
--                           total cover after inbound is still short)
--   - no inbound          → reorder_plus_montreal (0 < 90 lead_time AND
--                           0 < safety buffer)
--
-- Safe to re-run.

create or replace view purchasing_reorder_view as
with s as (
  select safety_stock_days, expected_fill, lead_time_days
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
  (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.safety_stock_days)::numeric as reorder_point,
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
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < (s.lead_time_days + s.safety_stock_days)
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    when ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < (s.lead_time_days + s.safety_stock_days)
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
