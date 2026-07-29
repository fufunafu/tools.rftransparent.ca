-- Bug reports: the Problem Tickets idea turned on our own software.
--
-- Why: we run several systems (this Tools app, InvoiceBox, Order Stream) and
-- bugs in them get reported by WhatsApp, in person, or not at all — so the
-- same thing gets reported three times and fixed none. Problem Tickets solved
-- exactly this shape of mess for customer issues; this is the same structure
-- with "client" replaced by "system" and "type" classifying the error.
--
-- Four tables: the systems list (user-extensible, so a new asset doesn't need
-- a migration), the reports, a comment thread per report, and screenshots.

-- ── Systems ──────────────────────────────────────────────────────────────
-- Deliberately a table, not a check constraint: anyone reporting a bug can
-- name a system that doesn't exist yet and it's there for everyone after.
create table if not exists bug_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness so "InvoiceBox" and "invoicebox" can't both
-- exist and split one system's bugs across two rows.
create unique index if not exists bug_systems_name_key
  on bug_systems (lower(name));

-- ── Reports ──────────────────────────────────────────────────────────────
create table if not exists bug_reports (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references bug_systems(id) on delete restrict,
  title text not null,
  -- Error class (crash / wrong_data / ui / slow / access / workflow / other).
  -- Text rather than an enum, matching problem_tickets: new categories are a
  -- UI change, not a migration.
  type text not null default 'other',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'repaired', 'wont_fix')),
  -- What happened, and how to make it happen again.
  description text,
  steps text,
  reported_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when status flips to repaired; created_at -> repaired_at is how long
  -- a bug sat unfixed.
  repaired_at timestamptz
);

create index if not exists bug_reports_status_idx on bug_reports (status);
create index if not exists bug_reports_created_idx on bug_reports (created_at desc);
create index if not exists bug_reports_system_idx on bug_reports (system_id);

-- ── Comments ─────────────────────────────────────────────────────────────
-- A thread rather than one resolution field: fixing a bug usually needs a
-- question answered first ("which store were you on?").
create table if not exists bug_comments (
  id uuid primary key default gen_random_uuid(),
  bug_id uuid not null references bug_reports(id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists bug_comments_bug_idx on bug_comments (bug_id, created_at);

-- ── Screenshots ──────────────────────────────────────────────────────────
-- Rows point at objects in the private `bug-attachments` storage bucket; the
-- bytes are served through /api/bugs/attachments/[id], which checks the app
-- session first. Deleting a report drops its rows here, and the API deletes
-- the matching objects.
create table if not exists bug_attachments (
  id uuid primary key default gen_random_uuid(),
  bug_id uuid not null references bug_reports(id) on delete cascade,
  -- Object path inside the bucket, e.g. "<bug_id>/<uuid>-screenshot.png".
  path text not null,
  filename text,
  content_type text,
  size_bytes integer,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists bug_attachments_bug_idx on bug_attachments (bug_id, created_at);

-- Seed the systems we already know about. Anyone can add more from the form.
insert into bug_systems (name)
select v.name from (values ('Tools'), ('InvoiceBox'), ('Order Stream')) as v(name)
where not exists (
  select 1 from bug_systems b where lower(b.name) = lower(v.name)
);

-- API routes access these with the service-role key; no anon policies needed.
alter table bug_systems enable row level security;
alter table bug_reports enable row level security;
alter table bug_comments enable row level security;
alter table bug_attachments enable row level security;
