-- What a new employee is given access to, and how they sign in to it.
--
-- Onboarding used to live in one person's head: which systems a warehouse hire
-- needs, who owns the Shopify seat, whether the Google account is the login or
-- just the mailbox. None of it was written down, so the second week of every
-- hire was spent finding out what was missed. One row per person per system,
-- created from a department template and edited before it is sent.
--
-- This table records the DECISION, never the credential. Passwords live in
-- Supabase Auth or in the account's own provider; nothing here is a secret.

create table if not exists public.employee_access (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  -- Free text rather than a lookup: the list of systems changes faster than
  -- migrations do, and the templates in access-templates.ts constrain what the
  -- form actually offers.
  system text not null,
  login_method text not null default 'none'
    check (login_method in ('google_sso', 'microsoft_sso', 'password', 'magic_link', 'none')),
  -- The username the person types, when it differs from their work email.
  account_id text,
  -- Who to ask about this system. An address, so it survives someone changing
  -- roles better than a name would.
  owner_email text,
  status text not null default 'not_requested'
    check (status in ('not_requested', 'requested', 'active', 'revoked')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_access_employee
  on public.employee_access (employee_id);

create index if not exists employee_access_status
  on public.employee_access (status);

-- API routes access this with the service-role key; no anon policies needed.
alter table public.employee_access enable row level security;
