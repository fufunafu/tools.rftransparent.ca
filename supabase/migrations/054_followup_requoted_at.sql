-- "Re-Quote" action: when a quote changes (new measurements) or a lost lead
-- comes back, the rep resets the follow-up instead of treating it as a new
-- quote. requoted_at records when that happened so the lead can show the
-- re-quote date instead of the original Shopify creation date.
--
-- Optional: the Re-Quote action still resets the follow-up without this column;
-- the date stamp is just skipped until the migration runs. Safe to re-run.

alter table followup_leads
  add column if not exists requoted_at timestamptz;
