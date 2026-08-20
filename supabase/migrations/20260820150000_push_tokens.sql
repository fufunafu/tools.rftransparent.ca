-- Device tokens for push notifications (APNs). One row per device token;
-- tokens rotate, so re-registration upserts by token and stale rows are
-- disabled when Apple reports them dead (410 Unregistered).

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  user_email text not null,
  token text not null unique,
  platform text not null default 'ios',
  created_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now(),
  -- Set when APNs reports the token dead; disabled tokens are skipped.
  disabled_at timestamptz
);

create index if not exists push_tokens_employee
  on public.push_tokens (employee_id)
  where disabled_at is null;

alter table public.push_tokens enable row level security;

-- "Still clocked in?" reminder bookkeeping — at most one nudge per shift.
alter table public.time_entries
  add column if not exists reminder_sent_at timestamptz;
