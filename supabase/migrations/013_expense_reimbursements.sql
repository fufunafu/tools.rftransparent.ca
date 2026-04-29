-- Expense reimbursement requests submitted by staff.
-- Receipts are sent separately by email to finance@glass-railing.com;
-- this table only captures the structured request and approval state.
-- `id` is `serial` so the email subject can read "Reimbursement #42" rather
-- than a UUID. employee_id is a soft FK populated when the submitter's
-- email matches an active employee row.

create table if not exists expense_reimbursements (
  id                 serial primary key,
  submitted_by_email text not null,
  employee_id        uuid references employees(id) on delete set null,
  expense_date       date not null,
  amount             numeric(10,2) not null check (amount > 0),
  vendor             text not null,
  category           text not null,
  description        text,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  rejection_reason   text,
  reviewed_at        timestamptz,
  reviewed_by_email  text,
  submitted_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_reimb_status
  on expense_reimbursements (status, submitted_at desc);
create index if not exists idx_reimb_submitter
  on expense_reimbursements (submitted_by_email, submitted_at desc);
