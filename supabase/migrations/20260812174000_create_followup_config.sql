-- The original followup_config definition used migration prefix 009, which
-- collided with 009_email_enhancements.sql. Production recorded the email
-- migration under that version, so the archived config migration never ran.

create table if not exists public.followup_config (
  store_id text not null,
  category text not null,
  followup_days integer,
  primary key (store_id, category),
  constraint followup_config_days_check
    check (followup_days is null or followup_days between 1 and 3650)
);

alter table public.followup_config enable row level security;
