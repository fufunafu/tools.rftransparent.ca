-- Store the sales reporting fields once, then apply Shopify updated_at deltas.
-- Separate from the pipeline mirror because payments, refunds, addresses and
-- customer names are required here and are absent from pipeline payloads.
create table if not exists public.sales_shopify_records (
  store_id text not null,
  resource_type text not null check (resource_type in ('order', 'draft')),
  shopify_id text not null,
  created_at timestamptz not null,
  shopify_updated_at timestamptz not null,
  payload jsonb not null,
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (store_id, resource_type, shopify_id)
);
create index if not exists sales_shopify_records_created_idx
  on public.sales_shopify_records (store_id, resource_type, created_at) where deleted_at is null;
create index if not exists sales_shopify_records_updated_idx
  on public.sales_shopify_records (store_id, resource_type, shopify_updated_at) where deleted_at is null;
create table if not exists public.sales_shopify_sync_state (
  store_id text not null,
  resource_type text not null check (resource_type in ('order', 'draft')),
  history_from timestamptz not null,
  bootstrap_scope text not null,
  last_synced_at timestamptz not null,
  records_synced integer not null default 0,
  primary key (store_id, resource_type)
);
alter table public.sales_shopify_records enable row level security;
alter table public.sales_shopify_sync_state enable row level security;
revoke all on public.sales_shopify_records, public.sales_shopify_sync_state from anon, authenticated;
grant all on public.sales_shopify_records, public.sales_shopify_sync_state to service_role;
comment on table public.sales_shopify_records is 'Service-only incremental sales reporting mirror. Deletions retain a recoverable tombstone.';
