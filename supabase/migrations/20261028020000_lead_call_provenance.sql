-- Leave existing statuses unattributed. Their editor cannot be reconstructed.
alter table public.leads
  add column call_status_source text check (call_status_source in ('manual', 'phone_sync', 'system')),
  add column call_status_changed_by text,
  add column call_status_changed_at timestamptz;

create table public.lead_call_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  source text not null,
  actor_email text,
  changed_at timestamptz not null
);
create index lead_call_status_history_lead on public.lead_call_status_history(lead_id, changed_at desc);
alter table public.lead_call_status_history enable row level security;
revoke all on public.lead_call_status_history from public, anon, authenticated;
grant select, insert on public.lead_call_status_history to service_role;

create function public.lead_call_provenance_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.call_status is distinct from old.call_status
    or new.call_status_source is distinct from old.call_status_source
    or new.call_status_changed_by is distinct from old.call_status_changed_by
    or new.call_status_changed_at is distinct from old.call_status_changed_at then
    -- Older writers must never retain another employee's attribution.
    if new.call_status_changed_at is not distinct from old.call_status_changed_at
      or new.call_status_source is null then
      new.call_status_source := 'system';
      new.call_status_changed_by := null;
    end if;
    if new.call_status_source = 'manual' and nullif(trim(new.call_status_changed_by), '') is null then
      raise exception 'Manual call status requires an authenticated employee';
    end if;
    new.call_status_changed_at := statement_timestamp();
  end if;
  return new;
end;
$$;
create trigger lead_call_provenance_before_update
before update of call_status, call_status_source, call_status_changed_by, call_status_changed_at on public.leads
for each row execute function public.lead_call_provenance_before_update();

create function public.lead_call_provenance_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.call_status_changed_at is distinct from old.call_status_changed_at then
    insert into public.lead_call_status_history(lead_id,previous_status,new_status,source,actor_email,changed_at)
    values(new.id,old.call_status,new.call_status,new.call_status_source,new.call_status_changed_by,new.call_status_changed_at);
  end if;
  return new;
end;
$$;
create trigger lead_call_provenance_after_update
  after update on public.leads for each row execute function public.lead_call_provenance_after_update();
revoke all on function public.lead_call_provenance_before_update(), public.lead_call_provenance_after_update() from public, anon, authenticated;
