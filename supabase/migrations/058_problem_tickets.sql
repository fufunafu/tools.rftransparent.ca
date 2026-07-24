-- Problem tickets: client-facing issues (delivery errors, broken glass,
-- wrong orders, ...) previously tracked in a Notion table. Kept here so we
-- can chart volumes by type/month and measure year-over-year improvement.

create table if not exists problem_tickets (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  -- Day the problem was reported (Toronto calendar date, not a timestamp).
  ticket_date date not null,
  -- Who is handling it. Free text so "Shanaz, Cris" works like in Notion.
  person text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'resolved')),
  -- Category slug (missing_items / incorrect_order / broken_glass / shipping
  -- / measurements / tariffs / other). Text, not an enum, so new categories
  -- don't need a migration; the UI constrains the choices.
  type text not null default 'other',
  -- What happened / next step (Notion "Next item").
  issue text,
  -- How it was closed (Notion "Closing of the Ticket").
  resolution text,
  store text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when status flips to resolved; ticket_date -> resolved_at gives
  -- days-to-resolve for the improvement metrics.
  resolved_at timestamptz
);

create index if not exists problem_tickets_ticket_date_idx
  on problem_tickets (ticket_date desc);
create index if not exists problem_tickets_status_idx
  on problem_tickets (status);

-- API routes access this with the service-role key; no anon policies needed.
alter table problem_tickets enable row level security;
