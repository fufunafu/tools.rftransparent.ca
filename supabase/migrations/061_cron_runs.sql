-- Scheduled-job run history.
--
-- Why: five jobs run unattended (call sync, follow-up sync, follow-up
-- reminders, employee surveys, problem digest). Until now the only signal
-- that one broke was a failure email — and no signal at all that one simply
-- stopped firing. This table gives /settings/automations a "last ran"
-- answer per job.
--
-- Rows are small and capped by the cleanup at the bottom, so this stays tiny.

create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  -- Job slug, matching the route name under /api/cron/ (e.g. "sync-calls").
  job text not null,
  status text not null default 'success'
    check (status in ('success', 'error', 'skipped')),
  -- Free-text outcome summary: item counts on success, the error on failure.
  detail text,
  -- Set when a person pressed "Run now" instead of the schedule firing it.
  triggered_by text,
  duration_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

-- The page only ever asks for "latest runs of job X".
create index if not exists cron_runs_job_started_idx
  on cron_runs (job, started_at desc);

-- API routes access this with the service-role key; no anon policies needed.
alter table cron_runs enable row level security;

-- Keep the table from growing without bound. 90 days is well past the point
-- where an old run tells you anything useful.
create or replace function prune_cron_runs() returns void language sql as $$
  delete from cron_runs where started_at < now() - interval '90 days';
$$;
