-- Let staff close spam, forwarded, and unquotable submissions without
-- treating them as lost sales opportunities.

alter table leads add column if not exists not_applicable_reason text;

alter table leads drop constraint if exists leads_outcome_check;

alter table leads
  add constraint leads_outcome_check
  check (outcome in ('new', 'contacted', 'quoted', 'won', 'lost', 'not_applicable'));
