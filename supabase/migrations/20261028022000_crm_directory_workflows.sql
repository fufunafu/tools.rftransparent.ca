-- Local edits and saved views remain separate from the retained HubSpot source.
create index crm_audit_record_time on public.crm_audit(record_id,created_at desc,id desc);
create table public.crm_saved_views (
  id uuid primary key,
  owner_email text not null,
  object_type text not null check(object_type in ('contacts','companies')),
  name text not null check(length(btrim(name)) between 1 and 80),
  config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<30000),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create unique index crm_saved_view_name on public.crm_saved_views(owner_email,object_type,lower(name));
create table public.crm_bulk_requests (
  id uuid primary key, actor_email text not null, payload jsonb not null,
  result jsonb not null, created_at timestamptz not null default now()
);
alter table public.crm_saved_views enable row level security;
alter table public.crm_bulk_requests enable row level security;
revoke all on public.crm_saved_views,public.crm_bulk_requests from public,anon,authenticated;
grant all on public.crm_saved_views,public.crm_bulk_requests to service_role;

create function public.crm_save_view(p_id uuid,p_version integer,p_type text,p_name text,p_config jsonb,p_actor text)
returns integer language plpgsql set search_path=public as $$
declare existing crm_saved_views;
begin
  if p_actor is null or btrim(p_actor)='' or p_id is null then raise exception 'Invalid view owner'; end if;
  -- Serialize this owner's writes so the per-person limit holds under concurrency.
  perform pg_advisory_xact_lock(hashtextextended('crm_views:'||p_actor,0));
  select * into existing from crm_saved_views where id=p_id for update;
  if found then
    if existing.owner_email<>p_actor or existing.version<>p_version or existing.object_type<>p_type then raise exception 'View changed or unavailable'; end if;
    update crm_saved_views set name=btrim(p_name),config=p_config,version=version+1,updated_at=now() where id=p_id;
    return existing.version+1;
  end if;
  if p_version is distinct from 0 then raise exception 'View unavailable'; end if;
  if (select count(*) from crm_saved_views where owner_email=p_actor)>=50 then raise exception 'Saved view limit reached'; end if;
  insert into crm_saved_views(id,owner_email,object_type,name,config) values(p_id,p_actor,p_type,btrim(p_name),p_config);
  return 1;
end $$;

create function public.crm_edit_directory_record(p_id text,p_version integer,p_fields jsonb,p_company_id text,p_actor text)
returns integer language plpgsql set search_path=public as $$
declare r crm_records; company_record crm_records; before_fields jsonb; added integer;
begin
  if p_actor is null or btrim(p_actor)='' or jsonb_typeof(p_fields) is distinct from 'object' or p_fields='{}'::jsonb then raise exception 'Invalid edit'; end if;
  if exists(select 1 from jsonb_each(p_fields) f where f.key not in
    ('title','email','phone','company','stage','owner_email','address','city','region','country','postal_code','website','domain')
    or jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>500) then raise exception 'Invalid fields'; end if;
  if p_fields ? 'title' and length(btrim(p_fields->>'title')) not between 1 and 300 then raise exception 'Name required'; end if;
  select * into r from crm_records where id=p_id and object_type in ('contacts','companies') and not archived for update;
  if not found or r.version is distinct from p_version then raise exception 'Record changed or unavailable'; end if;
  if p_company_id is not null then
    if r.object_type<>'contacts' then raise exception 'Choose a contact to link'; end if;
    select * into company_record from crm_records where id=p_company_id and object_type='companies' and not archived for key share;
    if not found then raise exception 'Company unavailable'; end if;
    p_fields:=p_fields||jsonb_build_object('company',coalesce(nullif(company_record.local_fields->>'title',''),company_record.title));
  end if;
  before_fields:=r.view_fields||jsonb_build_object('title',r.title,'owner_email',coalesce(r.owner_email,''))||r.local_fields;
  update crm_records set local_fields=local_fields||p_fields,version=version+1,updated_at=now() where id=p_id;
  if p_company_id is not null then
    insert into crm_links(from_id,to_id,label,source) values(p_id,p_company_id,'associated','tools') on conflict do nothing;
    get diagnostics added=row_count;
    if added>0 then insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'company_linked',jsonb_build_object('companyId',p_company_id,'company',p_fields->>'company')); end if;
  end if;
  insert into crm_audit(record_id,actor_email,action,detail)
    values(p_id,p_actor,'record_updated',jsonb_build_object('before',(select jsonb_object_agg(key,before_fields->key) from jsonb_object_keys(p_fields) key),'after',p_fields));
  return r.version+1;
end $$;

create function public.crm_bulk_directory_action(p_id uuid,p_payload jsonb,p_actor text)
returns jsonb language plpgsql set search_path=public as $$
declare existing crm_bulk_requests; r crm_records; item jsonb; change jsonb:=p_payload->'change';
  total integer; checked integer:=0; next_version integer; task_id text; results jsonb:='[]'; result jsonb;
begin
  if p_id is null or p_actor is null or btrim(p_actor)='' or jsonb_typeof(p_payload->'records') is distinct from 'array'
    or p_payload->>'type' not in ('contacts','companies') or p_payload->>'type' is null
    or change->>'kind' not in ('owner','stage','task') or change->>'kind' is null then raise exception 'Invalid bulk action'; end if;
  total:=jsonb_array_length(p_payload->'records');
  if total not between 1 and 50 or (select count(distinct x->>'id') from jsonb_array_elements(p_payload->'records') x)<>total then raise exception 'Invalid selection'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_bulk:'||p_id::text,0));
  select * into existing from crm_bulk_requests where id=p_id;
  if found then
    if existing.actor_email<>p_actor or existing.payload<>p_payload then raise exception 'Request already used'; end if;
    return existing.result;
  end if;
  -- Check and lock the entire selection before making any change.
  for r in select c.* from crm_records c where c.id in (select x->>'id' from jsonb_array_elements(p_payload->'records') x) order by c.id for update loop
    select x into item from jsonb_array_elements(p_payload->'records') x where x->>'id'=r.id;
    if r.archived or r.object_type<>p_payload->>'type' or r.version is distinct from (item->>'version')::integer then raise exception 'Selection changed. Refresh before applying'; end if;
    checked:=checked+1;
  end loop;
  if checked<>total then raise exception 'Selected record unavailable'; end if;
  if change->>'kind' in ('owner','stage') and (jsonb_typeof(change->'value') is distinct from 'string' or length(change->>'value')>320) then raise exception 'Invalid value'; end if;
  if change->>'kind'='task' and (length(btrim(coalesce(change->>'title',''))) not between 1 and 300 or change->>'dueAt' is null or length(coalesce(change->>'body',''))>10000) then raise exception 'Invalid task'; end if;
  for item in select x from jsonb_array_elements(p_payload->'records') x order by x->>'id' loop
    if change->>'kind'='task' then
      task_id:=crm_create_record(gen_random_uuid(),'tasks',change->>'title',coalesce(change->>'body',''),'{}'::jsonb,now(),(change->>'dueAt')::timestamptz,item->>'id',p_actor);
      insert into crm_audit(record_id,actor_email,action,detail) values(item->>'id',p_actor,'followup_created',jsonb_build_object('taskId',task_id,'title',change->>'title','dueAt',change->>'dueAt','requestId',p_id));
      results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','taskId',task_id));
    else
      next_version:=crm_edit_directory_record(item->>'id',(item->>'version')::integer,jsonb_build_object(case when change->>'kind'='owner' then 'owner_email' else 'stage' end,change->>'value'),null,p_actor);
      results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','version',next_version));
    end if;
  end loop;
  result:=jsonb_build_object('updated',total,'records',results);
  insert into crm_bulk_requests(id,actor_email,payload,result) values(p_id,p_actor,p_payload,result);
  return result;
end $$;

-- A compact summary avoids joining every activity for each directory request.
-- Existing records are queued without rewriting or decompressing source blobs.
create table public.crm_followup_summary (
  record_id text primary key references public.crm_records(id) on delete cascade,
  last_contacted_at timestamptz, next_task_id text, next_task_title text, next_task_due_at timestamptz,
  open_task_count integer not null default 0, checked_at timestamptz not null default now()
);
create table public.crm_followup_queue (
  record_id text primary key references public.crm_records(id) on delete cascade,
  queued_at timestamptz not null default now()
);
create index crm_followup_pending on public.crm_followup_queue(queued_at,record_id);
create index crm_followup_last_contact on public.crm_followup_summary(last_contacted_at,record_id);
create index crm_followup_next_task on public.crm_followup_summary(next_task_due_at,record_id);
alter table public.crm_followup_summary enable row level security;
alter table public.crm_followup_queue enable row level security;
revoke all on public.crm_followup_summary,public.crm_followup_queue from public,anon,authenticated;
grant all on public.crm_followup_summary,public.crm_followup_queue to service_role;

create function public.crm_queue_followup(p_id text) returns void language sql set search_path=public as $$
  insert into crm_followup_queue(record_id)
  select id from crm_records where object_type in ('contacts','companies') and id in (
    select p_id union select to_id from crm_links where from_id=p_id union select from_id from crm_links where to_id=p_id)
  on conflict(record_id) do update set queued_at=least(crm_followup_queue.queued_at,excluded.queued_at);
$$;
create function public.crm_followup_record_changed() returns trigger language plpgsql set search_path=public as $$
begin
  if new.object_type in ('contacts','companies','calls','emails','meetings','tasks') then perform crm_queue_followup(new.id); end if;
  return new;
end $$;
create trigger crm_followup_record_changed after insert or update of occurred_at,due_at,due_at_override,task_status,task_status_override,archived,title,local_fields on public.crm_records
  for each row execute function public.crm_followup_record_changed();
create function public.crm_followup_link_changed() returns trigger language plpgsql set search_path=public as $$
declare from_record text; to_record text;
begin
  from_record:=case when tg_op='DELETE' then old.from_id else new.from_id end;
  to_record:=case when tg_op='DELETE' then old.to_id else new.to_id end;
  -- Only endpoints can be affected. The opposite endpoint may be an activity.
  insert into crm_followup_queue(record_id) select id from crm_records where id in (from_record,to_record) and object_type in ('contacts','companies')
    on conflict(record_id) do update set queued_at=least(crm_followup_queue.queued_at,excluded.queued_at);
  return null;
end $$;
create trigger crm_followup_link_changed after insert or delete on public.crm_links for each row execute function public.crm_followup_link_changed();

create function public.crm_refresh_followups(p_limit integer default 20) returns integer language plpgsql set search_path=public as $$
declare picked record; last_contact timestamptz; next_contact timestamptz; task_id text; task_title text; task_due timestamptz; task_count integer; processed integer:=0;
begin
  for picked in select q.record_id from crm_followup_queue q where q.queued_at<=now() order by q.queued_at,q.record_id for update skip locked limit least(greatest(p_limit,1),100) loop
    with linked as (select to_id id from crm_links where from_id=picked.record_id union select from_id from crm_links where to_id=picked.record_id)
    select max(r.occurred_at) filter(where r.occurred_at<=now()),min(r.occurred_at) filter(where r.occurred_at>now()) into last_contact,next_contact
      from linked l join crm_records r on r.id=l.id where not r.archived and r.object_type in ('calls','emails','meetings');
    with linked as (select to_id id from crm_links where from_id=picked.record_id union select from_id from crm_links where to_id=picked.record_id)
    select count(*)::integer into task_count from linked l join crm_records r on r.id=l.id where not r.archived and r.object_type='tasks' and r.effective_task_status='open';
    with linked as (select to_id id from crm_links where from_id=picked.record_id union select from_id from crm_links where to_id=picked.record_id)
    select r.id,coalesce(nullif(r.local_fields->>'title',''),r.title),r.effective_due_at into task_id,task_title,task_due
      from linked l join crm_records r on r.id=l.id where not r.archived and r.object_type='tasks' and r.effective_task_status='open'
      order by r.effective_due_at nulls last,r.id limit 1;
    insert into crm_followup_summary(record_id,last_contacted_at,next_task_id,next_task_title,next_task_due_at,open_task_count,checked_at)
      values(picked.record_id,last_contact,task_id,task_title,task_due,task_count,now())
      on conflict(record_id) do update set last_contacted_at=excluded.last_contacted_at,next_task_id=excluded.next_task_id,
        next_task_title=excluded.next_task_title,next_task_due_at=excluded.next_task_due_at,open_task_count=excluded.open_task_count,checked_at=excluded.checked_at;
    delete from crm_followup_queue where record_id=picked.record_id;
    if next_contact is not null then insert into crm_followup_queue(record_id,queued_at) values(picked.record_id,next_contact); end if;
    processed:=processed+1;
  end loop;
  return processed;
end $$;
insert into public.crm_followup_queue(record_id) select id from public.crm_records where object_type in ('contacts','companies');

create or replace view public.crm_directory with (security_invoker=true) as
select r.id,r.object_type,r.source,r.portal_id,r.hubspot_id,r.title,r.summary,
  nullif(coalesce(r.local_fields->>'owner_email',r.owner_email),'') owner_email,r.occurred_at,
  r.effective_due_at,r.effective_task_status,r.archived,r.version,r.created_by_email,
  r.reminder_enabled,r.reminder_minutes,r.view_fields,r.local_fields,r.search_document,
  lower(btrim(coalesce(nullif(r.local_fields->>'title',''),r.title))) as directory_name,
  lower(btrim(coalesce(r.local_fields->>'owner_email',r.owner_email,''))) as filter_owner,
  lower(btrim(coalesce(r.local_fields->>'stage',r.view_fields->>'stage',''))) as filter_stage,
  lower(btrim(coalesce(r.local_fields->>'country',r.view_fields->>'country',''))) as filter_country,
  lower(btrim(coalesce(r.local_fields->>'region',r.view_fields->>'region',''))) as filter_region,
  lower(btrim(coalesce(r.local_fields->>'city',r.view_fields->>'city',''))) as filter_city,
  case when r.local_fields ? 'stage' and r.local_fields->>'stage' is distinct from r.view_fields->>'stage'
    then r.local_fields->>'stage' else coalesce(nullif(r.view_fields->>'stage_label',''),r.view_fields->>'stage','') end as stage_label,
  f.last_contacted_at,f.next_task_id,f.next_task_title,f.next_task_due_at,f.open_task_count,f.checked_at as followup_checked_at
from public.crm_records r left join public.crm_followup_summary f on f.record_id=r.id where r.object_type in ('contacts','companies');
create index crm_directory_local_owner on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(local_fields->>'owner_email',owner_email,'')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');

-- A durable cooldown is shared by import and indexing workers across requests.
create table public.crm_worker_backoff (
  worker text primary key, failures integer not null default 0,
  pause_until timestamptz, batch_size integer not null default 20,
  last_latency_ms integer, updated_at timestamptz not null default now()
);
alter table public.crm_worker_backoff enable row level security;
revoke all on public.crm_worker_backoff from public,anon,authenticated;
grant all on public.crm_worker_backoff to service_role;
create function public.crm_worker_feedback(p_worker text,p_latency integer,p_failed boolean)
returns void language plpgsql set search_path=public as $$
begin
  if p_worker not in ('import','index','followups','files') or p_latency<0 or p_failed is null then raise exception 'Invalid worker feedback'; end if;
  insert into crm_worker_backoff(worker) values(p_worker) on conflict do nothing;
  update crm_worker_backoff set
    failures=case when p_failed then least(failures+1,6) else greatest(failures-1,0) end,
    batch_size=case when p_failed or p_latency>1500 then greatest(1,batch_size/2) when p_latency<500 then least(30,batch_size+2) else batch_size end,
    pause_until=case when p_failed then now()+least(600,30*power(2,failures)) * interval '1 second'
      when p_latency>=5000 then now()+interval '60 seconds' else pause_until end,
    last_latency_ms=p_latency,updated_at=now() where worker=p_worker;
end $$;

do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
    ('crm_save_view','crm_edit_directory_record','crm_bulk_directory_action','crm_queue_followup','crm_followup_record_changed','crm_followup_link_changed','crm_refresh_followups','crm_worker_feedback') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
