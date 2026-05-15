-- Purchasing: products, purchase orders, line items, settings, and a
-- prediction view that mirrors the formulas from ORDERING-TEMPLATE.xlsx.
--
-- daily_sales       = (avg_monthly_sales_grs + avg_monthly_sales_rf) / 30
-- days_of_stock     = current_inventory / daily_sales
-- reorder_point     = daily_sales × safety_stock_days
-- perfect_qty       = max(0, capacity - current_inventory + lead_time_days × daily_sales)
-- sop_label         = one of: out_of_stock | no_sales_data | reorder | ok
--
-- Safe to re-run (uses `if not exists` / `create or replace`).

-- ─── products ────────────────────────────────────────────────────────────────

create table if not exists purchasing_products (
  id                     uuid primary key default gen_random_uuid(),
  category               text not null check (category in ('glass', 'hardware')),
  sku                    text not null unique,
  name                   text not null,
  height                 numeric,
  width                  numeric,
  weight                 numeric,
  storage_capacity       numeric not null default 0,
  unit_cost_landed       numeric(10, 2) not null default 0,
  current_inventory      numeric not null default 0,
  avg_monthly_sales_grs  numeric not null default 0,
  avg_monthly_sales_rf   numeric not null default 0,
  active                 boolean not null default true,
  sort_order             integer not null default 0,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_purchasing_products_category_sku
  on purchasing_products (category, sku);
create index if not exists idx_purchasing_products_active
  on purchasing_products (active) where active;

-- ─── orders ──────────────────────────────────────────────────────────────────

create table if not exists purchasing_orders (
  id                uuid primary key default gen_random_uuid(),
  po_number         text not null unique,
  status            text not null default 'draft'
                    check (status in ('draft', 'ordered', 'in_transit', 'received', 'cancelled')),
  supplier_name     text not null default 'Allen',
  order_date        date,
  eta_date          date,
  received_date     date,
  notes             text,
  created_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_purchasing_orders_status_date
  on purchasing_orders (status, order_date desc nulls last);

-- ─── order items ─────────────────────────────────────────────────────────────

create table if not exists purchasing_order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references purchasing_orders(id) on delete cascade,
  product_id          uuid not null references purchasing_products(id),
  qty_ordered         numeric not null default 0,
  qty_received        numeric not null default 0,
  unit_cost_snapshot  numeric(10, 2) not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists idx_purchasing_order_items_order
  on purchasing_order_items (order_id);
create index if not exists idx_purchasing_order_items_product
  on purchasing_order_items (product_id);

-- ─── settings (single row) ───────────────────────────────────────────────────

create table if not exists purchasing_settings (
  id                int primary key default 1 check (id = 1),
  safety_stock_days int not null default 30,
  expected_fill     numeric not null default 0.7,
  lead_time_days    int not null default 90,
  updated_at        timestamptz not null default now()
);

insert into purchasing_settings (id) values (1) on conflict (id) do nothing;

-- ─── receive trigger ─────────────────────────────────────────────────────────

create or replace function purchasing_apply_receive_delta()
returns trigger
language plpgsql
as $$
declare
  delta numeric;
begin
  if tg_op = 'INSERT' then
    delta := coalesce(new.qty_received, 0);
  elsif tg_op = 'UPDATE' then
    delta := coalesce(new.qty_received, 0) - coalesce(old.qty_received, 0);
  else
    delta := 0;
  end if;

  if delta <> 0 then
    update purchasing_products
       set current_inventory = current_inventory + delta,
           updated_at = now()
     where id = new.product_id;
  end if;

  if tg_op = 'UPDATE' and new.qty_received > old.qty_received then
    if not exists (
      select 1 from purchasing_order_items
       where order_id = new.order_id
         and qty_received < qty_ordered
    ) then
      update purchasing_orders
         set status = 'received',
             received_date = coalesce(received_date, current_date),
             updated_at = now()
       where id = new.order_id
         and status <> 'received'
         and status <> 'cancelled';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_purchasing_apply_receive_delta on purchasing_order_items;
create trigger trg_purchasing_apply_receive_delta
after insert or update of qty_received on purchasing_order_items
for each row execute function purchasing_apply_receive_delta();

-- ─── inbound view ────────────────────────────────────────────────────────────

create or replace view purchasing_inbound_by_product as
select
  poi.product_id,
  coalesce(sum(poi.qty_ordered - poi.qty_received), 0)::numeric as inbound_qty
from purchasing_order_items poi
join purchasing_orders po on po.id = poi.order_id
where po.status in ('ordered', 'in_transit')
group by poi.product_id;

-- ─── reorder view (initial — will be replaced by 021 with inbound-aware logic) ──

create or replace view purchasing_reorder_view as
with s as (
  select safety_stock_days, expected_fill, lead_time_days from purchasing_settings where id = 1
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
    p.storage_capacity - p.current_inventory
      + (s.lead_time_days * ((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0))
  )::numeric as perfect_qty,
  (p.current_inventory * p.unit_cost_landed)::numeric as inventory_value,
  (p.current_inventory - p.storage_capacity)::numeric as overstock,
  case
    when (p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) = 0 then 'no_sales_data'
    when p.current_inventory = 0 then 'out_of_stock'
    when p.current_inventory <
         (((p.avg_monthly_sales_grs + p.avg_monthly_sales_rf) / 30.0) * s.safety_stock_days)
      then 'reorder'
    else 'ok'
  end::text as sop_label
from purchasing_products p
cross join s
left join purchasing_inbound_by_product ib on ib.product_id = p.id;

-- ─── updated_at touch triggers ───────────────────────────────────────────────

create or replace function purchasing_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_purchasing_products_touch on purchasing_products;
create trigger trg_purchasing_products_touch before update on purchasing_products
for each row execute function purchasing_touch_updated_at();

drop trigger if exists trg_purchasing_orders_touch on purchasing_orders;
create trigger trg_purchasing_orders_touch before update on purchasing_orders
for each row execute function purchasing_touch_updated_at();

drop trigger if exists trg_purchasing_order_items_touch on purchasing_order_items;
create trigger trg_purchasing_order_items_touch before update on purchasing_order_items
for each row execute function purchasing_touch_updated_at();

drop trigger if exists trg_purchasing_settings_touch on purchasing_settings;
create trigger trg_purchasing_settings_touch before update on purchasing_settings
for each row execute function purchasing_touch_updated_at();

-- ─── PO number sequence ──────────────────────────────────────────────────────

create sequence if not exists purchasing_po_seq start 1;

create or replace function purchasing_assign_po_number()
returns trigger language plpgsql as $$
begin
  if new.po_number is null or length(trim(new.po_number)) = 0 then
    new.po_number := 'PO-' || to_char(now(), 'YYYY') || '-'
                     || lpad(nextval('purchasing_po_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_purchasing_orders_po_number on purchasing_orders;
create trigger trg_purchasing_orders_po_number
before insert on purchasing_orders
for each row execute function purchasing_assign_po_number();
