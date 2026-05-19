-- Hardware support.
--
-- Hardware items don't have a physical storage capacity (they don't take
-- meaningful warehouse space) so the "capacity-driven" reorder math used
-- for glass doesn't apply. Instead we derive a target stock per row:
--
--   target = max(50, 3 × (avg_monthly_sales_grs + avg_monthly_sales_rf))
--
-- That is: hold at least 3 months of demand, with a 50-unit floor for
-- SKUs that have no sales data yet.
--
-- Implementation: a new per-row CTE `effective` computes
-- `effective_capacity` and `effective_fill_floor`. The main SELECT
-- shadows `storage_capacity` with `effective_capacity` (aliased) so
-- every downstream consumer — UI columns and downstream view math —
-- sees the right number with no changes. Two columns branch on
-- category explicitly: `overstock` (zero for hardware) and
-- `suggested_qty` (no crate rounding for hardware).

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
-- Per-row derived target. For hardware: 3-month demand with a 50-unit
-- floor; for glass: the raw stored capacity.
effective as (
  select
    p.id,
    case p.category
      when 'hardware'
        then greatest(50, 3 * (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf))
      else p.storage_capacity
    end::numeric as effective_capacity,
    case p.category
      when 'hardware'
        then greatest(50, 3 * (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf))
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
  -- Shadow storage_capacity with the effective target. For glass this is
  -- the stored value; for hardware it's the derived 3-month / 50-unit
  -- floor. All UI columns and downstream math see this value.
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
  -- Overstock concept doesn't apply to hardware (no physical limit).
  case p.category
    when 'hardware' then 0
    else (p.current_inventory - p.storage_capacity)
  end::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0 then
      case
        -- Hardware still needs the 50-unit floor even without sales data.
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
  -- Hardware ships in arbitrary whole units (no crate constraint).
  -- Glass goes through the crate-rounding helper.
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
