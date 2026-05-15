-- Crate-aware "Perfect Number to order".
--
-- Orders from China ship in crates (35 units today, but configurable).
-- Half-crates are tolerated for very small needs; otherwise quantities
-- must be whole crates — no 2.5-crate orders.
--
-- The Excel formula (column Q in ORDERING-TEMPLATE.xlsx) implements
-- this rounding:
--
--   n = max(capacity - total_inventory + lead_time_demand, 0)
--   q = floor(n / crate)
--   r = n - q × crate
--   if n = 0           → 0
--   else if q = 0      → if n ≤ ⌊2c/3⌋ then ⌈c/2⌉ else c
--   else               → q × c + (if r ≤ ⌊2c/3⌋ then 0 else c)
--
-- The 2/3-of-a-crate threshold for "round up" is preserved from the
-- spreadsheet (23 when c=35); it's a heuristic the user already trusts.
--
-- Safe to re-run.

-- 1. Add crate_size to purchasing_settings.
alter table purchasing_settings
  add column if not exists crate_size numeric not null default 35;

-- 2. Helper function: round raw demand to allowed crate fractions.
create or replace function purchasing_round_to_crate(n numeric, c numeric)
returns numeric
language sql
immutable
as $$
  select case
    when n is null or n <= 0 or c is null or c <= 0 then 0
    when n < c then
      case when n <= floor(2 * c / 3) then ceil(c / 2.0) else c end
    else
      (floor(n / c) * c)
      + case
          when (n - floor(n / c) * c) <= floor(2 * c / 3) then 0
          else c
        end
  end;
$$;

-- 3. Rebuild the view with crate-rounded perfect_qty.
create or replace view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size
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
  -- New: crate-rounded suggestion.
  purchasing_round_to_crate(
    greatest(
      0,
      p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
        + (s.lead_time_days * ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0))
    ),
    s.crate_size
  )::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  (p.current_inventory - p.storage_capacity)::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0
      then 'no_sales_data'
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and (
           ((p.current_inventory + coalesce(ib.inbound_qty, 0))
              / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
              < (2 * s.lead_time_days)
        or (p.current_inventory + coalesce(ib.inbound_qty, 0))
              < (s.expected_fill * p.storage_capacity)
         )
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
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
