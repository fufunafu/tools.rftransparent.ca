-- Annual growth multiplier on top of seasonality. Models "we expect to
-- sell X% more this year than last year" without having to re-touch every
-- monthly multiplier.
--
-- effective_daily = base_monthly/30 × season_multipliers[month] × (1 + annual_growth_pct/100)
--
-- The 12 season_multipliers stay normalized around 1.0 (they describe the
-- *shape* of the year). Growth is a single number that lifts the whole
-- curve. Setting it to 0 keeps current behavior unchanged.

alter table purchasing_settings
  add column if not exists annual_growth_pct numeric not null default 0;

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
    p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
      + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
  )::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  (p.current_inventory - p.storage_capacity)::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0
      then 'no_sales_data'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
     and (
           ((p.current_inventory + coalesce(ib.inbound_qty, 0))
              / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
              < (2 * s.lead_time_days)
        or (p.current_inventory + coalesce(ib.inbound_qty, 0))
              < (s.expected_fill * p.storage_capacity)
         )
      then 'reorder_plus_montreal'
    when (p.current_inventory
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
         < coalesce(sa.days_until_arrival, s.lead_time_days)
      then 'montreal_transfer'
    when ((p.current_inventory + coalesce(ib.inbound_qty, 0))
          / nullif(((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor, 0))
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
            / (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
    else null
  end::numeric as days_of_stock_with_inbound,
  sa.days_until_arrival as days_until_next_arrival,
  purchasing_round_to_crate(
    greatest(
      0,
      p.storage_capacity - (p.current_inventory + coalesce(ib.inbound_qty, 0))
        + (s.lead_time_days * (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.season_mult * s.growth_factor))
    ),
    s.crate_size
  )::numeric as suggested_qty
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id
left join soonest_arrival sa on sa.product_id = p.id;
