-- Add resolution_type to email_dismissed_threads to distinguish
-- "dismissed" (irrelevant, no action needed) from "resolved" (handled without a reply email).
alter table email_dismissed_threads
  add column if not exists resolution_type text not null default 'dismissed'
  check (resolution_type in ('dismissed', 'resolved'));

-- Custom noise filter rules (user-added domains/prefixes).
-- Hardcoded defaults stay in code; this table holds additions from the UI.
create table if not exists email_noise_rules (
  id         uuid primary key default gen_random_uuid(),
  rule_type  text not null check (rule_type in ('prefix', 'domain')),
  value      text not null,
  created_at timestamptz not null default now(),
  unique (rule_type, value)
);
