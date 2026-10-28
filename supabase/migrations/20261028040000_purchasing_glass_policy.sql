-- Demand-based glass planning. Retain legacy settings for older deployments.
alter table public.purchasing_settings add column if not exists glass_policy jsonb not null default
  '{"order_interval_days":30,"fast_safety_days":21,"regular_safety_days":14,"slow_safety_days":7,"slow_min_units":2,"delay_days":21}'::jsonb;
-- Replace the reviewed legacy assumption, without overwriting a newer manual setting.
update public.purchasing_settings set lead_time_days = 84 where id = 1 and lead_time_days = 70;
