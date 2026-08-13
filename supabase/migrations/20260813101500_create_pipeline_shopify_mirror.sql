-- Persistent Shopify mirror for fast pipeline calculations.
-- The service role writes compact order payloads incrementally using Shopify's
-- updated_at watermark. Dashboard requests read this local table instead of
-- downloading two years of history from Shopify each time.

create table if not exists pipeline_shopify_records (
  store_id           text not null,
  resource_type      text not null check (resource_type in ('order', 'draft')),
  shopify_id         text not null,
  created_at         timestamptz not null,
  shopify_updated_at timestamptz not null,
  payload            jsonb not null,
  synced_at          timestamptz not null default now(),
  primary key (store_id, resource_type, shopify_id)
);

create index if not exists idx_pipeline_shopify_records_created
  on pipeline_shopify_records (store_id, resource_type, created_at);
create index if not exists idx_pipeline_shopify_records_updated
  on pipeline_shopify_records (store_id, resource_type, shopify_updated_at);

create table if not exists pipeline_shopify_sync_state (
  store_id       text not null,
  resource_type  text not null check (resource_type in ('order', 'draft')),
  history_from   timestamptz not null,
  last_synced_at timestamptz not null,
  records_synced integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (store_id, resource_type)
);

alter table pipeline_shopify_records enable row level security;
alter table pipeline_shopify_sync_state enable row level security;

comment on table pipeline_shopify_records is
  'Incremental local mirror of Shopify records used by the sales pipeline.';
comment on table pipeline_shopify_sync_state is
  'Per-store watermarks for incremental pipeline Shopify synchronization.';
