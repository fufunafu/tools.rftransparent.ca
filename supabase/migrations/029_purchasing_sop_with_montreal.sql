-- New sop_label taxonomy on purchasing_reorder_view.
--
-- The old SOP (inherited from the Excel) ignored inbound and used one
-- "reorder" status for everything below the threshold. Two real-world
-- problems:
--
--   1. With lots of POs in transit, it still said "Reorder now".
--   2. It didn't distinguish the urgent case where on-hand alone runs
--      out before a new 90-day main-supplier order could land. In
--      that case we need a fast restock from a closer warehouse
--      (Montreal), not a fresh main order.
--
-- New statuses:
--   out_of_stock           on_hand = 0
--   no_sales_data          daily_sales = 0
--   montreal_restock       on-hand days < lead_time_days AND inbound > 0
--                          (main pipeline OK; bridge gap with Montreal)
--   reorder_plus_montreal  on-hand days < lead_time_days AND inbound = 0
--                          (need both a new main order AND Montreal)
--   reorder                total (on_hand + inbound) days < lead_time +
--                          safety_stock_days, but on-hand alone still
--                          covers >= lead_time days. Comfortable to
--                          wait the 90-day main-supplier lead.
--   ok                     otherwise
--
-- The view column list stays identical to migration 021 so this
-- create-or-replace works without a drop.
--
-- Safe to re-run.

create or replace view purchasing_reorder_view as
with s as (
  select safety_stock_days, expected_fill, lead_time_days
    from purchasing_settings where id = 1
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
    -- On-hand alone runs out before a 90-day main order could land:
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < s.lead_time_days
      then case
             when coalesce(ib.inbound_qty, 0) > 0 then 'montreal_restock'
             else 'reorder_plus_montreal'
           end
    -- Otherwise on-hand alone is fine; just check whether total inventory
    -- (on-hand + inbound) is dipping below the safety+lead buffer.
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
  end::numeric as days_of_stock_with_inbound
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id;
