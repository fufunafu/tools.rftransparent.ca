-- Duplicate review: let staff dismiss an email's "possible duplicate" group as
-- legitimately-separate orders. Stamping the leads hides the group from the
-- Duplicates tab until a NEW (un-stamped) quote for that email shows up.

alter table followup_leads
  add column if not exists dup_dismissed_at timestamptz,
  add column if not exists dup_dismissed_by text;

-- Speeds up the Duplicates tab grouping (active leads, by email, per store).
create index if not exists idx_followup_leads_dup_email
  on followup_leads (store_id, customer_email)
  where closed_at is null;
