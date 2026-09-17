-- Field sales ownership, required follow-ups, and Shopify quote attribution.

alter table public.field_sales_accounts
  add column if not exists assigned_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists territory text,
  add column if not exists account_type text not null default 'prospect',
  add column if not exists distributor_group text,
  add column if not exists lifecycle_status text not null default 'active';

alter table public.field_sales_accounts
  drop constraint if exists field_sales_accounts_account_type_check,
  add constraint field_sales_accounts_account_type_check
    check (account_type in ('prospect', 'customer', 'channel_partner')),
  drop constraint if exists field_sales_accounts_lifecycle_status_check,
  add constraint field_sales_accounts_lifecycle_status_check
    check (lifecycle_status in ('active', 'watch', 'dormant', 'inactive')),
  drop constraint if exists field_sales_accounts_territory_length_check,
  add constraint field_sales_accounts_territory_length_check
    check (territory is null or char_length(territory) <= 120),
  drop constraint if exists field_sales_accounts_distributor_group_length_check,
  add constraint field_sales_accounts_distributor_group_length_check
    check (distributor_group is null or char_length(distributor_group) <= 160);

create index if not exists field_sales_accounts_owner_idx
  on public.field_sales_accounts (assigned_employee_id, lifecycle_status, lower(name));
create index if not exists field_sales_accounts_territory_idx
  on public.field_sales_accounts (territory) where territory is not null;

create table if not exists public.field_sales_followups (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.field_sales_visits(id) on delete cascade,
  account_id uuid not null references public.field_sales_accounts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  action_type text not null
    check (action_type in ('follow_up', 'prepare_quote', 'send_samples', 'call_contact', 'schedule_visit', 'no_further_action')),
  due_at date,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_sales_followups_due_date_required
    check (action_type = 'no_further_action' or due_at is not null),
  constraint field_sales_followups_no_action_closed
    check (action_type <> 'no_further_action' or (status = 'completed' and due_at is null)),
  constraint field_sales_followups_completed_timestamp
    check ((status = 'completed') = (completed_at is not null))
);

create index if not exists field_sales_followups_employee_due_idx
  on public.field_sales_followups (employee_id, due_at)
  where status = 'open';
create index if not exists field_sales_followups_account_idx
  on public.field_sales_followups (account_id, created_at desc);

create table if not exists public.field_sales_revenue_links (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.field_sales_visits(id) on delete cascade,
  account_id uuid not null references public.field_sales_accounts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  lead_id uuid not null unique references public.followup_leads(id) on delete cascade,
  link_source text not null default 'manual'
    check (link_source in ('manual', 'exact_contact')),
  linked_by_email text not null,
  created_at timestamptz not null default now(),
  constraint field_sales_revenue_links_visit_lead_unique unique (visit_id, lead_id)
);

create index if not exists field_sales_revenue_links_employee_idx
  on public.field_sales_revenue_links (employee_id, created_at desc);
create index if not exists field_sales_revenue_links_account_idx
  on public.field_sales_revenue_links (account_id, created_at desc);

alter table public.field_sales_followups enable row level security;
alter table public.field_sales_revenue_links enable row level security;

create or replace function public.complete_field_sales_visit(
  p_visit_id uuid,
  p_employee_id uuid,
  p_checked_out_at timestamptz,
  p_odometer_end_km numeric,
  p_outcome text,
  p_notes text,
  p_next_action_type text,
  p_next_action_due_at date,
  p_next_action_notes text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_visit public.field_sales_visits%rowtype;
  next_status text;
  next_completed_at timestamptz;
begin
  select * into current_visit
  from public.field_sales_visits
  where id = p_visit_id
    and employee_id = p_employee_id
    and status = 'open'
  for update;

  if not found then
    return false;
  end if;

  if p_checked_out_at <= current_visit.checked_in_at then
    raise exception 'Checkout must be after check-in';
  end if;
  if p_odometer_end_km is not null
    and current_visit.odometer_start_km is not null
    and p_odometer_end_km < current_visit.odometer_start_km then
    raise exception 'Ending odometer cannot be lower than starting odometer';
  end if;
  if p_next_action_type <> 'no_further_action' and p_next_action_due_at is null then
    raise exception 'A due date is required for the next action';
  end if;

  next_status := case when p_next_action_type = 'no_further_action' then 'completed' else 'open' end;
  next_completed_at := case when next_status = 'completed' then p_checked_out_at else null end;

  update public.field_sales_visits
  set status = 'completed',
      checked_out_at = p_checked_out_at,
      odometer_end_km = p_odometer_end_km,
      outcome = p_outcome,
      notes = nullif(btrim(p_notes), ''),
      updated_at = p_checked_out_at
  where id = current_visit.id;

  insert into public.field_sales_followups (
    visit_id,
    account_id,
    employee_id,
    action_type,
    due_at,
    notes,
    status,
    completed_at,
    updated_at
  ) values (
    current_visit.id,
    current_visit.account_id,
    current_visit.employee_id,
    p_next_action_type,
    case when p_next_action_type = 'no_further_action' then null else p_next_action_due_at end,
    nullif(btrim(p_next_action_notes), ''),
    next_status,
    next_completed_at,
    p_checked_out_at
  )
  on conflict (visit_id) do update set
    action_type = excluded.action_type,
    due_at = excluded.due_at,
    notes = excluded.notes,
    status = excluded.status,
    completed_at = excluded.completed_at,
    updated_at = excluded.updated_at;

  if current_visit.appointment_id is not null then
    update public.field_sales_appointments
    set status = 'completed', updated_at = p_checked_out_at
    where id = current_visit.appointment_id
      and employee_id = current_visit.employee_id;
  end if;

  update public.field_sales_accounts
  set assigned_employee_id = coalesce(assigned_employee_id, current_visit.employee_id),
      updated_at = p_checked_out_at
  where id = current_visit.account_id;

  return true;
end;
$$;

revoke all on function public.complete_field_sales_visit(uuid, uuid, timestamptz, numeric, text, text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.complete_field_sales_visit(uuid, uuid, timestamptz, numeric, text, text, text, date, text)
  to service_role;
