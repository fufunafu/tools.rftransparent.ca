-- Activity log for the Purchasing module. Captures who changed what, when.
-- Written from the API handlers (not triggers) so we capture actor email.
--
-- Safe to re-run.

create table if not exists purchasing_activity_log (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,
  product_id    uuid references purchasing_products(id) on delete set null,
  order_id      uuid references purchasing_orders(id) on delete set null,
  field         text,
  old_value     text,
  new_value     text,
  actor_email   text,
  details       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_purchasing_activity_created
  on purchasing_activity_log (created_at desc);
create index if not exists idx_purchasing_activity_product
  on purchasing_activity_log (product_id, created_at desc);
create index if not exists idx_purchasing_activity_order
  on purchasing_activity_log (order_id, created_at desc);
