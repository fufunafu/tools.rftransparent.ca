-- Some people sign in with a personal Google account separate from their
-- work email (e.g., @gmail.com vs. @glass-railing.com). Give each employee
-- an optional second email that also grants login access. The primary
-- `email` column stays the work identity used for KPI joins, todo
-- assignments, follow-up notifications, and reimbursements — only the
-- auth lookup considers `email_alt`.

alter table employees add column if not exists email_alt text;

-- Lookups normalize to lowercase, so uniqueness must be case-insensitive.
-- The work `email` column already enforces its own uniqueness; this index
-- prevents the same address being attached to two different employees as
-- an alt, and prevents an alt from collapsing into someone else's primary
-- email isn't enforced here — the auth check tolerates that (first hit
-- wins) and the admin form should refuse duplicates client-side.
create unique index if not exists employees_email_alt_unique_idx
  on employees (lower(email_alt))
  where email_alt is not null;
