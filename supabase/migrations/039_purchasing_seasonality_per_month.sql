-- Replace 3-tier seasonality (Low/Mid/High + month tags) with one
-- multiplier per calendar month, populated from Shopify history.
--
-- The recompute endpoint will fill this array from the last 12 *completed*
-- months of orders across all connected stores, dividing each month's
-- revenue by the trailing-12-month average. So each multiplier is exactly
-- "how much above or below average this month tends to be."
--
-- Default is [1, 1, … 1] — no scaling until the user clicks Recompute or
-- edits the numbers manually.

-- 1) Drop the view first so we can drop the columns it depends on.
drop view if exists purchasing_reorder_view;

-- 2) Drop the 3-tier columns.
alter table purchasing_settings
  drop constraint if exists purchasing_settings_season_months_check;

alter table purchasing_settings
  drop column if exists season_low_mult,
  drop column if exists season_mid_mult,
  drop column if exists season_high_mult,
  drop column if exists season_months;

-- 2) Add the per-month array.
alter table purchasing_settings
  add column if not exists season_multipliers numeric[]
    not null
    default array[1,1,1,1,1,1,1,1,1,1,1,1]::numeric[];

alter table purchasing_settings
  drop constraint if exists purchasing_settings_season_multipliers_check;
alter table purchasing_settings
  add constraint purchasing_settings_season_multipliers_check
  check (array_length(season_multipliers, 1) = 12);

-- Positivity is enforced at the API layer (see PATCH /purchasing/settings
-- and POST /purchasing/settings/recompute-seasonality). Postgres CHECK
-- constraints can't contain subqueries, so per-element validation lives
-- in app code rather than in the schema.

-- 3) Recreate the view to index the array by current month.
create or replace view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size,
    season_multipliers[extract(month from current_date)::int] as season_mult
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
  (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult)::numeric as daily_sales,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) > 0
      then (p.current_inventory
            / (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult))
    else null
  end::numeric as days_of_stock_left,
  ((((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult) * s.lead_time_days)::numeric as reorder_point,
  greatest(
    0,
    p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
      + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult))
  )::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  (p.current_inventory - p.storage_capacity)::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0
      then 'no_sales_data'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and (
           ((p.current_inventory + coalesce(ib.inbound_qty, 0))
              / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult, 0))
              < (2 * s.lead_time_days)
        or (p.current_inventory + coalesce(ib.inbound_qty, 0))
              < (s.expected_fill * p.storage_capacity)
         )
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    when ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult, 0))
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
            / (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult))
    else null
  end::numeric as days_of_stock_with_inbound,
  sa.days_until_arrival as days_until_next_arrival,
  purchasing_round_to_crate(
    greatest(
      0,
      p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
        + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult))
    ),
    s.crate_size
  )::numeric as suggested_qty
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id
left join soonest_arrival sa on sa.product_id = p.id;
