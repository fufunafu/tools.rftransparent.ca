-- Leads: form submissions from the website (Powerful Form Builder) and
-- Meta lead-ad forms. Tracks the call → quote → outcome workflow.
--
-- Safe to re-run.

-- ─── leads ───────────────────────────────────────────────────────────────────

create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),

  -- Where the lead came from
  source          text not null check (source in ('website', 'meta')),
  source_detail   text,                    -- form name, page URL, ad campaign, etc.
  form_id         text,                    -- Powerful Form Builder form id (when known)
  page_url        text,

  -- Submission fields (best-effort extracted from the raw payload)
  name            text,
  email           text,
  phone           text,
  message         text,

  -- Everything the form sent, untouched, so we never lose information.
  raw_payload     jsonb not null,

  submitted_at    timestamptz not null default now(),

  -- ─── Workflow columns ────────────────────────────────────────────────────
  call_status     text not null default 'not_called'
                  check (call_status in ('not_called', 'no_answer', 'called')),
  outcome         text not null default 'new'
                  check (outcome in ('new', 'contacted', 'quoted', 'won', 'lost')),

  -- Quote linkage (free-form for now — we can FK to Shopify draft orders later)
  quote_number    text,
  quote_amount    numeric(10, 2),
  quote_sent_at   timestamptz,

  lost_reason     text,
  notes           text,
  assigned_to     text,                    -- staff member email or name

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_leads_source on leads (source);
create index if not exists idx_leads_call_status on leads (call_status);
create index if not exists idx_leads_outcome on leads (outcome);
create index if not exists idx_leads_submitted_at on leads (submitted_at desc);
create index if not exists idx_leads_email on leads (email) where email is not null;
create index if not exists idx_leads_phone on leads (phone) where phone is not null;

-- ─── lead_call_attempts ──────────────────────────────────────────────────────

create table if not exists lead_call_attempts (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  staff       text not null,
  result      text not null,
  notes       text,
  called_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_lead_call_attempts_lead_id
  on lead_call_attempts (lead_id, called_at desc);

-- ─── updated_at trigger ──────────────────────────────────────────────────────

create or replace function leads_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at
  before update on leads
  for each row execute function leads_set_updated_at();
