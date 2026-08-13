-- Clock in/out shifts. One row per shift; clock_out_at null while the shift
-- is running. location_name is a snapshot of the employee's store at
-- clock-in (no FK — matches how other tables treat locations, and history
-- stays correct if an employee changes stores).

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  location_name text,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  -- True when the entry needs manager review (e.g. the employee forgot to
  -- clock out and self-reported the end time later).
  flagged boolean not null default false,
  flag_reason text,
  edited_by text,
  edit_note text,
  created_at timestamptz not null default now(),
  constraint time_entries_out_after_in
    check (clock_out_at is null or clock_out_at > clock_in_at)
);

-- At most one running shift per employee, enforced at the database level so
-- double-taps and races can't create overlapping open shifts.
create unique index if not exists time_entries_one_open_shift
  on public.time_entries (employee_id)
  where clock_out_at is null;

create index if not exists time_entries_employee_recent
  on public.time_entries (employee_id, clock_in_at desc);

alter table public.time_entries enable row level security;
