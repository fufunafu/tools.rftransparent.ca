-- ETA-aware Montreal trigger + independent reorder flag.
--
-- Changes from migration 029:
--   1. The Montreal-restock check now uses the SOONEST inbound PO ETA
--      per product instead of the flat `lead_time_days` constant.
--      If our soonest inbound PO arrives before we'd run out of
--      on-hand stock, no Montreal is needed — inbound saves us.
--   2. The combined "reorder + montreal" state now fires whenever
--      BOTH flags are set, not only when inbound = 0. This catches
--      the case where inbound is coming but is still insufficient
--      for long-term cover.
--   3. Adds `days_until_next_arrival` as a new column at the end of
--      the view (Postgres only allows create-or-replace VIEW to add
--      columns at the end).
--
-- needs_montreal = days_of_stock_left
--                  < coalesce(days_until_next_arrival, lead_time_days)
-- needs_reorder  = days_of_stock_with_inbound
--                  < (lead_time_days + safety_stock_days)
--
-- Safe to re-run.

create or replace view purchasing_reorder_view as
with s as (
  select safety_stock_days, expected_fill, lead_time_days
    from purchasing_settings where id = 1
),
soonest_arrival as (
  -- Per product: how many days until the next inbound PO arrives.
  -- Past-dated ETAs clamp to 0 (treated as "arriving today").
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
    when p.current_inventory = 0
      then 'out_of_stock'
    -- Both flags set → reorder + Montreal
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < (s.lead_time_days + s.safety_stock_days)
      then 'reorder_plus_montreal'
    -- needs_montreal only (long-term cover is fine after inbound arrives)
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_restock'
    -- needs_reorder only (inbound arrives in time but long-term cover is low)
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
  -- Appended (must remain last): days until next inbound PO arrives, or
  -- null if there's no upcoming arrival.
  sa.days_until_arrival as days_until_next_arrival
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id
left join soonest_arrival sa on sa.product_id = p.id;
