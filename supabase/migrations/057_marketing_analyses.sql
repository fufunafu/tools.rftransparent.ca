-- Saved marketing analyses: occasional written reports (audit findings, ROAS
-- interpretation, recommendations) kept on the Marketing page so they aren't
-- lost in chat threads. Written rarely, by hand — no automation involved.

create table if not exists marketing_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  analysis_date date not null,
  content text not null,
  created_by text,
  created_at timestamptz not null default now()
);

-- API routes access this with the service-role key; no anon policies needed.
alter table marketing_analyses enable row level security;
