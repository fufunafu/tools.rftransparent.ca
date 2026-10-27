-- Per-device operational notification preferences. Preferences default on so
-- existing registered devices preserve current reminder behavior.

alter table public.push_tokens
  add column if not exists task_updates boolean not null default true,
  add column if not exists overdue_updates boolean not null default true,
  add column if not exists clock_reminders boolean not null default true,
  add column if not exists followup_updates boolean not null default true,
  add column if not exists callback_updates boolean not null default true;

alter table public.push_tokens
  add column if not exists apns_environment text not null default 'production';

alter table public.push_tokens
  drop constraint if exists push_tokens_apns_environment_check;

alter table public.push_tokens
  add constraint push_tokens_apns_environment_check
  check (apns_environment in ('sandbox', 'production'));
