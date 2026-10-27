-- Leads now belong to a store, mirroring the phone dashboard's
-- rf_transparent / bc_transparent split. Every existing lead came from the RF
-- website or RF's Meta lead ads, so the default backfills them all as RF.
-- BC only has website leads (no Meta), which arrive through the same Shopify
-- app proxy and are tagged by the shop that signed the request.

alter table leads
  add column if not exists store_id text not null default 'rf_transparent';

alter table leads drop constraint if exists leads_store_id_check;
alter table leads
  add constraint leads_store_id_check
  check (store_id in ('rf_transparent', 'bc_transparent'));

create index if not exists idx_leads_store_submitted_at
  on leads (store_id, submitted_at desc);
