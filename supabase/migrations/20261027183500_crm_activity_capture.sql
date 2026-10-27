-- Capture only new activity from the existing business integrations. The
-- historical HubSpot timeline remains the source of older activity.
create table public.crm_capture_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default true,
  started_at timestamptz not null default now()
);
insert into public.crm_capture_settings(singleton) values(true);
create table public.crm_capture_events (
  id uuid primary key default gen_random_uuid(), source_key text not null unique,
  kind text not null check(kind in ('calls','emails')),
  payload jsonb not null,
  occurred_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processing','captured','review','ignored')),
  reason text, matched_ids text[] not null default '{}',
  record_id text references public.crm_records(id), contact_id text references public.crm_records(id),
  revision integer not null default 1, lease_token uuid, lease_until timestamptz,
  reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index crm_capture_events_pending on public.crm_capture_events(status,occurred_at,id);

create function public.crm_queue_business_activity() returns trigger language plpgsql set search_path=public as $$
declare k text; t text; happened timestamptz; p jsonb:=to_jsonb(new); active_since timestamptz;
begin
  select started_at into active_since from crm_capture_settings where singleton and enabled;
  if active_since is null then return new; end if;
  if tg_table_name='email_messages' then
    if new.inbox not in ('info@glass-railing.com','info@glassrailingstore.com','anne@cloture-verre.com') then return new; end if;
    t:='emails'; happened:=new.received_at; k:='gmail:'||new.inbox||':'||new.message_id;
  else
    if new.store_id not in ('rf_transparent','glass_railing_store','bc_transparent') or new.source not in ('grasshopper','cik') then return new; end if;
    t:='calls'; happened:=new.call_start; k:='call:'||new.store_id||':'||new.id;
  end if;
  if happened<active_since or happened>now()+interval '1 day' then return new; end if;
  insert into crm_capture_events(source_key,kind,payload,occurred_at) values(k,t,p,happened)
  on conflict(source_key) do update set payload=excluded.payload,occurred_at=excluded.occurred_at,
    revision=crm_capture_events.revision+1,status=case when crm_capture_events.reviewed_at is null then 'pending' else crm_capture_events.status end,
    lease_token=null,lease_until=null,updated_at=now()
  where crm_capture_events.payload is distinct from excluded.payload;
  return new;
end $$;
create trigger crm_capture_email after insert or update on public.email_messages for each row execute function public.crm_queue_business_activity();
create trigger crm_capture_call after insert or update on public.call_records for each row execute function public.crm_queue_business_activity();

create function public.crm_claim_capture(p_token uuid,p_limit integer default 50) returns setof public.crm_capture_events language sql set search_path=public as $$
  with picked as (
    select id from crm_capture_events where (status='pending' or (status='processing' and lease_until<now()))
      -- The short delay lets forwarded call legs arrive together for deduplication.
      and created_at<now()-interval '3 minutes'
      and not exists(select 1 from crm_projection_queue q join crm_records r on r.id=q.record_id where r.object_type='contacts')
    order by occurred_at,id for update skip locked limit least(greatest(p_limit,1),100)
  ) update crm_capture_events e set status='processing',lease_token=p_token,lease_until=now()+interval '5 minutes' from picked p where e.id=p.id returning e.*;
$$;
create function public.crm_finish_capture(p_id uuid,p_token uuid,p_revision integer,p_result jsonb,p_actor text default null)
returns text language plpgsql set search_path=public as $$
declare e crm_capture_events; target text:=p_result->>'contact_id'; rid text; action text:=p_result->>'status';
begin
  select * into e from crm_capture_events where id=p_id for update;
  if not found or e.revision<>p_revision then raise exception 'Activity changed. Refresh before saving.'; end if;
  if p_actor is null and (e.status<>'processing' or e.lease_token is distinct from p_token or e.lease_until<now()) then raise exception 'Activity lease expired'; end if;
  if p_actor is not null and e.status<>'review' then raise exception 'Activity already reviewed'; end if;
  if action not in ('captured','review','ignored') then raise exception 'Invalid capture status'; end if;
  if action='captured' then
    if target is null or not exists(select 1 from crm_records where id=target and object_type='contacts' and not archived) then raise exception 'Contact unavailable'; end if;
    if e.contact_id is not null and e.contact_id<>target then raise exception 'Existing activity belongs to a different contact'; end if;
    rid:=coalesce(e.record_id,'tools:'||gen_random_uuid()::text);
    insert into crm_records(id,object_type,source,title,summary,body,occurred_at,properties)
    values(rid,e.kind,'tools',left(p_result->>'title',300),left(p_result->>'summary',1000),left(p_result->>'body',100000),e.occurred_at,
      jsonb_build_object('capture_source',case when e.kind='emails' then 'gmail_metadata' else 'call_records' end,'capture_key',e.source_key,'source_detail',e.payload))
    on conflict(id) do update set title=excluded.title,summary=excluded.summary,body=excluded.body,occurred_at=excluded.occurred_at,properties=excluded.properties,updated_at=now(),version=crm_records.version+1;
    insert into crm_links(from_id,to_id,label,source) values(rid,target,'automatic_activity','tools') on conflict do nothing;
    if e.record_id is null then insert into crm_audit(record_id,actor_email,action,detail) values(rid,coalesce(p_actor,'crm-automation'),'activity_captured',jsonb_build_object('source',e.source_key,'contact',target)); end if;
  end if;
  update crm_capture_events set status=action,reason=p_result->>'reason',matched_ids=coalesce(array(select jsonb_array_elements_text(p_result->'matched_ids')),'{}'),
    record_id=coalesce(rid,record_id),contact_id=coalesce(target,contact_id),lease_token=null,lease_until=null,
    reviewed_by=coalesce(p_actor,reviewed_by),reviewed_at=case when p_actor is not null then now() else reviewed_at end,updated_at=now() where id=p_id;
  return rid;
end $$;

create function public.crm_workflow_status() returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'pendingIndex',(select count(*) from crm_projection_queue),
    'contactIndexPending',(select count(*) from crm_projection_queue q join crm_records r on r.id=q.record_id where r.object_type='contacts'),
    'assets',coalesce((select jsonb_agg(x) from (select status,count(*) as total from crm_assets group by status) x),'[]'::jsonb),
    'capture',(select jsonb_build_object('enabled',enabled,'started_at',started_at) from crm_capture_settings where singleton),
    'captureCounts',coalesce((select jsonb_agg(x) from (select status,count(*) as total from crm_capture_events group by status) x),'[]'::jsonb)
  );
$$;
create function public.crm_assets_for_record(p_id text)
returns table(id text,kind text,filename text,status text,byte_size bigint,error_code text,copied_at timestamptz)
language sql stable set search_path=public as $$
  select a.id,a.kind,a.filename,a.status,a.byte_size,a.error_code,a.copied_at from crm_assets a where a.id in (
    select l.asset_id from crm_record_assets l where l.record_id=p_id or l.record_id in (
      select to_id from crm_links where from_id=p_id union select from_id from crm_links where to_id=p_id
    )
  );
$$;

do $$ declare t text; f regprocedure; begin
  foreach t in array array['crm_capture_settings','crm_capture_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy service_role_all on public.%I for all to service_role using(true) with check(true)',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('crm_queue_business_activity','crm_claim_capture','crm_finish_capture','crm_workflow_status','crm_assets_for_record') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
