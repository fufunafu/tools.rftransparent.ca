-- Separate prospect workflows from existing website/Meta sales analytics.
-- Only the server service role can access these records or RPCs.
begin;

create table public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  company_name text,
  source_ref text,
  paused boolean not null default false,
  owner_email text,
  suppressed_at timestamptz,
  suppression_reason text,
  suppression_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_cases (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.outreach_contacts(id),
  campaign_key text not null check (campaign_key in ('installer_network', 'materials_sales')),
  provider_campaign_id uuid,
  stage text not null default 'new' check (stage in ('new', 'contacted', 'replied', 'interested', 'later', 'declined', 'suppressed')),
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contact_id, campaign_key)
);

create table public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  contact_id uuid not null references public.outreach_contacts(id),
  campaign_key text check (campaign_key in ('installer_network', 'materials_sales')),
  event_type text not null,
  occurred_at timestamptz not null,
  event jsonb not null,
  plan jsonb,
  status text not null default 'pending' check (status in ('pending','processing','processed','held','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  locked_until timestamptz,
  available_at timestamptz not null default now(),
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index outreach_events_work on public.outreach_events(status, available_at, created_at);
create index outreach_events_contact on public.outreach_events(contact_id, occurred_at desc);

create table public.outreach_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.outreach_cases(id),
  event_id uuid not null references public.outreach_events(id),
  kind text not null check (kind in ('review_reply','application_details','collect_quote_details','review_callback')),
  title text not null,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  notes text,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One current next action for each offer. New replies update that task instead
-- of creating a second assignment for the same conversation.
create unique index outreach_tasks_current on public.outreach_tasks(case_id) where status = 'open';

create table public.outreach_audit (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.outreach_contacts(id),
  actor_email text not null,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- The event and immediate contact-level stop are committed together. Workers
-- cannot create new tasks for a contact after this transaction suppresses it.
create function public.outreach_ingest(p_event jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  c public.outreach_contacts;
  e public.outreach_events;
  k text := p_event->>'campaignKey';
begin
  insert into outreach_contacts(email, company_name)
    values (lower(btrim(p_event->>'email')), nullif(p_event->>'companyName',''))
    on conflict(email) do nothing;
  select * into c from outreach_contacts where email = lower(btrim(p_event->>'email')) for update;

  insert into outreach_events(dedupe_key, contact_id, campaign_key, event_type, occurred_at, event)
    values (p_event->>'dedupeKey', c.id, k, p_event->>'type', (p_event->>'occurredAt')::timestamptz, p_event)
    on conflict(dedupe_key) do nothing returning * into e;
  if e.id is null then
    -- A redelivery can include fuller text than the first notification. Never
    -- discard a newly explicit opt-out merely because the message was seen.
    if coalesce((p_event->>'suppress')::boolean, false) then
      update outreach_contacts set suppressed_at = coalesce(suppressed_at, now()),
        suppression_reason = coalesce(suppression_reason, p_event->>'type'), updated_at = now() where id = c.id;
      update outreach_cases set stage = 'suppressed', updated_at = now() where contact_id = c.id;
      update outreach_tasks set status = 'cancelled', updated_at = now()
        where status = 'open' and case_id in (select id from outreach_cases where contact_id = c.id);
    end if;
    return jsonb_build_object('duplicate', true);
  end if;

  if k is not null then
    insert into outreach_cases(contact_id, campaign_key, provider_campaign_id)
      values (c.id, k, (p_event->>'campaignId')::uuid)
      on conflict(contact_id, campaign_key) do update
        set provider_campaign_id = coalesce(excluded.provider_campaign_id, outreach_cases.provider_campaign_id);
  end if;
  if coalesce((p_event->>'suppress')::boolean, false) then
    update outreach_contacts set suppressed_at = coalesce(suppressed_at, now()),
      suppression_reason = coalesce(suppression_reason, p_event->>'type'), updated_at = now() where id = c.id;
    update outreach_cases set stage = 'suppressed', updated_at = now() where contact_id = c.id;
    update outreach_tasks set status = 'cancelled', updated_at = now()
      where status = 'open' and case_id in (select id from outreach_cases where contact_id = c.id);
  elsif c.suppressed_at is not null then
    update outreach_cases set stage = 'suppressed', updated_at = now() where contact_id = c.id;
  end if;
  update outreach_contacts set updated_at = now() where id = c.id;
  return jsonb_build_object('duplicate', false, 'id', e.id);
end $$;

create function public.outreach_claim(p_limit integer default 10) returns setof public.outreach_events
language plpgsql set search_path = public, pg_temp as $$
begin
  -- An expired fifth attempt becomes visible as failed instead of disappearing.
  update outreach_events set status = 'failed', error_code = 'lease_expired', locked_until = null
    where status = 'processing' and locked_until < now() and attempts >= 5;
  return query
    with candidates as (
      select id from outreach_events
      where attempts < 5 and available_at <= now()
        and (status = 'pending' or (status = 'processing' and locked_until < now()))
      order by created_at, id for update skip locked limit greatest(1, least(p_limit, 25))
    )
    update outreach_events e set status = 'processing', attempts = attempts + 1,
      lease_token = gen_random_uuid(), locked_until = now() + interval '3 minutes'
    from candidates c where e.id = c.id returning e.*;
end $$;

create function public.outreach_apply(p_id uuid, p_lease uuid, p_plan jsonb, p_event jsonb) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  e public.outreach_events;
  c public.outreach_contacts;
  target public.outreach_cases;
  t jsonb;
  stale boolean := false;
begin
  -- Always lock contacts before event rows, matching ingest/control lock order.
  select contact_id into e.contact_id from outreach_events where id = p_id;
  select * into c from outreach_contacts where id = e.contact_id for update;
  select * into e from outreach_events where id = p_id for update;
  if e.id is null or e.status <> 'processing' or e.lease_token is distinct from p_lease then return 'lease_lost'; end if;

  if coalesce((p_plan->>'suppress')::boolean, false) then
    update outreach_contacts set suppressed_at = coalesce(suppressed_at, now()),
      suppression_reason = coalesce(suppression_reason, 'reply_opt_out'), updated_at = now() where id = c.id;
    c.suppressed_at := now();
    update outreach_cases set stage = 'suppressed', updated_at = now() where contact_id = c.id;
    update outreach_tasks set status = 'cancelled', updated_at = now()
      where status = 'open' and case_id in (select id from outreach_cases where contact_id = c.id);
  end if;

  if e.campaign_key is not null then
    select * into target from outreach_cases where contact_id = c.id and campaign_key = e.campaign_key;
    stale := target.last_event_at is not null and target.last_event_at > e.occurred_at;
    if not stale and c.suppressed_at is null then
      update outreach_cases set
        stage = case when e.event_type = 'email_sent' and stage <> 'new' then stage else p_plan->>'stage' end,
        last_event_at = greatest(last_event_at, e.occurred_at), updated_at = now() where id = target.id;
    end if;
  end if;

  if c.suppressed_at is null and not c.paused and not stale then
    for t in select * from jsonb_array_elements(p_plan->'tasks') loop
      insert into outreach_cases(contact_id, campaign_key)
        values(c.id, t->>'campaignKey') on conflict(contact_id, campaign_key) do nothing;
      select * into target from outreach_cases where contact_id = c.id and campaign_key = t->>'campaignKey';
      -- Another campaign can have a newer decline. Do not revive it using an
      -- older reply from this campaign.
      if target.last_event_at is not null and target.last_event_at > e.occurred_at then continue; end if;
      update outreach_cases set stage = p_plan->>'stage', last_event_at = e.occurred_at, updated_at = now() where id = target.id;
      insert into outreach_tasks(case_id, event_id, kind, title)
        values(target.id, e.id, t->>'kind', t->>'title')
        on conflict(case_id) where status = 'open' do update set
          event_id = excluded.event_id, kind = excluded.kind, title = excluded.title, updated_at = now();
    end loop;
    if p_plan->>'stage' = 'declined' then
      update outreach_tasks set status = 'cancelled', updated_at = now()
        where status = 'open' and case_id in (select id from outreach_cases where contact_id = c.id and campaign_key = e.campaign_key);
    end if;
  end if;

  update outreach_events set status = case when c.paused and c.suppressed_at is null then 'held' else 'processed' end,
    event = p_event, plan = p_plan, processed_at = now(), locked_until = null, error_code = null where id = e.id;
  return case when stale then 'stale' when c.suppressed_at is not null then 'suppressed' when c.paused then 'held' else 'processed' end;
end $$;

create function public.outreach_fail(p_id uuid, p_lease uuid, p_code text) returns void
language sql set search_path = public, pg_temp as $$
  update outreach_events set status = case when attempts >= 5 then 'failed' else 'pending' end,
    error_code = left(p_code, 100), locked_until = null,
    available_at = now() + (least(3600, 30 * power(2, attempts))::text || ' seconds')::interval
    where id = p_id and status = 'processing' and lease_token = p_lease;
$$;

create function public.outreach_control(p_contact uuid, p_action text, p_actor text, p_task uuid default null, p_note text default '', p_event uuid default null) returns void
language plpgsql set search_path = public, pg_temp as $$
declare c public.outreach_contacts;
begin
  if nullif(btrim(p_actor),'') is null then raise exception 'Actor required'; end if;
  select * into c from outreach_contacts where id = p_contact for update;
  if c.id is null then raise exception 'Contact not found'; end if;
  if p_action = 'take_over' then
    update outreach_contacts set paused = true, owner_email = p_actor, updated_at = now() where id = c.id;
  elsif p_action = 'resume' then
    if c.suppressed_at is not null then raise exception 'Suppression cannot be removed here'; end if;
    update outreach_contacts set paused = false, updated_at = now() where id = c.id;
    -- Held work stays visible for review. Resuming does not replay old replies.
  elsif p_action = 'suppress' then
    update outreach_contacts set suppressed_at = coalesce(suppressed_at, now()),
      suppression_reason = coalesce(suppression_reason, 'staff_stop'), updated_at = now() where id = c.id;
    update outreach_cases set stage = 'suppressed', updated_at = now() where contact_id = c.id;
    update outreach_tasks set status = 'cancelled', updated_at = now()
      where status = 'open' and case_id in (select id from outreach_cases where contact_id = c.id);
  elsif p_action = 'complete_task' then
    if length(btrim(p_note)) < 3 or length(p_note) > 4000 then raise exception 'Completion note required'; end if;
    update outreach_tasks set status = 'done', notes = p_note, completed_by = p_actor, updated_at = now()
      where id = p_task and status = 'open' and event_id = p_event
        and case_id in (select id from outreach_cases where contact_id = c.id);
    if not found then raise exception 'Open task not found'; end if;
  elsif p_action = 'retry_event' then
    update outreach_events set status = 'pending', attempts = 0, available_at = now(), error_code = null,
      lease_token = null, locked_until = null where id = p_event and contact_id = c.id and status = 'failed';
    if not found then raise exception 'Failed event not found'; end if;
  elsif p_action = 'acknowledge_event' then
    if length(btrim(p_note)) < 3 or length(p_note) > 4000 then raise exception 'Review note required'; end if;
    update outreach_events set status = 'processed', processed_at = now()
      where id = p_event and contact_id = c.id and status = 'held';
    if not found then raise exception 'Held event not found'; end if;
  else raise exception 'Unknown action'; end if;
  insert into outreach_audit(contact_id, actor_email, action, detail)
    values(c.id, p_actor, p_action, jsonb_build_object('task_id', p_task, 'event_id', p_event, 'note', left(p_note,4000)));
end $$;

do $$
declare t text; f record;
begin
  foreach t in array array['outreach_contacts','outreach_cases','outreach_events','outreach_tasks','outreach_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('outreach_ingest','outreach_claim','outreach_apply','outreach_fail','outreach_control') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

commit;
