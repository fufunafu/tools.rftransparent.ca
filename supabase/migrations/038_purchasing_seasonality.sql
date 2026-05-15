-- Seasonality multipliers. The avg_monthly_sales_* values stored on each
-- product are the trailing-12-month average. Sales are bursty (e.g., May–Aug
-- runs ~1.6×, Dec–Feb runs ~0.5×), so a flat yearly rate over- or
-- under-orders during the off-peak / peak.
--
-- We model this with three tiers (Low / Mid / High) and a 12-character
-- string assigning each calendar month a tier (L / M / H). The view's
-- daily_sales (and everything derived from it: days-of-stock, reorder_point,
-- perfect_qty, suggested_qty, SOP status) is scaled by the *current* month's
-- multiplier so day-to-day buying decisions reflect the season.
--
-- The raw avg_monthly_sales_grs / avg_monthly_sales_rf columns stay
-- unscaled — those are what the user typed in and what the "Monthly"
-- column displays.

alter table purchasing_settings
  add column if not exists season_low_mult numeric not null default 1.0,
  add column if not exists season_mid_mult numeric not null default 1.0,
  add column if not exists season_high_mult numeric not null default 1.0,
  add column if not exists season_months text not null default 'MMMMMMMMMMMM';

-- Length sanity: exactly 12 chars, each L/M/H.
alter table purchasing_settings
  drop constraint if exists purchasing_settings_season_months_check;
alter table purchasing_settings
  add constraint purchasing_settings_season_months_check
  check (season_months ~ '^[LMH]{12}$');

-- Recreate the view with daily_sales scaled by the current month's
-- multiplier. Postgres views recompute on every query, so this picks
-- up the right tier automatically as the calendar advances.
create or replace view purchasing_reorder_view as
with s as (
  select expected_fill, lead_time_days, crate_size,
    case substring(season_months from extract(month from current_date)::int for 1)
      when 'L' then season_low_mult
      when 'H' then season_high_mult
      else season_mid_mult
    end as season_mult
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
  -- daily_sales is the *seasonal-adjusted* rate. Everything derived from
  -- it below picks up the same scaling automatically.
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
