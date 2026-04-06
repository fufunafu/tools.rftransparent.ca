-- Follow-up CRM: track draft order follow-ups to improve quote conversion rates

-- One row per draft order being tracked for follow-up
create table if not exists followup_leads (
  id                uuid primary key default gen_random_uuid(),
  store_id          text not null,
  shopify_draft_id  text not null,
  draft_name        text not null,
  customer_name     text,
  customer_email    text,
  customer_phone    text,
  quote_amount      numeric not null default 0,
  shopify_status    text not null,
  lead_status       text not null default 'new',
  next_followup_at  timestamptz,
  followup_count    integer not null default 0,
  first_synced_at   timestamptz not null default now(),
  last_synced_at    timestamptz not null default now(),
  closed_at         timestamptz,
  close_reason      text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (store_id, shopify_draft_id)
);

create index if not exists idx_followup_leads_next
  on followup_leads (store_id, next_followup_at)
  where closed_at is null;

create index if not exists idx_followup_leads_status
  on followup_leads (store_id, lead_status);

-- One row per follow-up attempt / outcome log
create table if not exists followup_logs (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references followup_leads(id) on delete cascade,
  outcome         text not null,
  notes           text,
  logged_by       text not null default 'admin',
  created_at      timestamptz not null default now()
);

create index if not exists idx_followup_logs_lead
  on followup_logs (lead_id, created_at desc);
