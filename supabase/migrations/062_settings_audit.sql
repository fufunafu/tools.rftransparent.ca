-- Who changed which setting, and when.
--
-- Why: notification recipients, forecast rates and admin access are now all
-- editable in the app. Without a trail, "the Monday digest started going to
-- the wrong address" has no answer — you can see the current value but not
-- who set it or when it changed.
--
-- Deliberately just a human-readable sentence per change rather than a
-- before/after diff: the point is to know who to ask, and a sentence stays
-- readable when the shape of a setting changes later.

create table if not exists settings_audit (
  id uuid primary key default gen_random_uuid(),
  -- Which settings page: notifications / rates / access / automations.
  area text not null,
  -- Email of the person who made the change.
  actor text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists settings_audit_area_created_idx
  on settings_audit (area, created_at desc);

-- API routes access this with the service-role key; no anon policies needed.
alter table settings_audit enable row level security;
