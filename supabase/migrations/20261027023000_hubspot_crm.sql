-- Additive CRM storage. Source properties and history remain independent of Tools edits.
create table public.crm_records (
  id text primary key,
  object_type text not null check (object_type in ('contacts','companies','deals','tickets','calls','meetings','emails','notes','tasks')),
  source text not null check (source in ('hubspot','tools')),
  portal_id text,
  hubspot_id text,
  title text not null,
  summary text not null default '',
  body text not null default '',
  owner_email text,
  occurred_at timestamptz,
  due_at timestamptz,
  task_status text check (task_status in ('open','completed')),
  task_status_override text check (task_status_override in ('open','completed')),
  due_at_override timestamptz,
  archived boolean not null default false,
  properties jsonb not null default '{}',
  property_history jsonb not null default '{}',
  source_created_at timestamptz,
  source_updated_at timestamptz,
  imported_at timestamptz,
  created_by_email text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  effective_task_status text generated always as (coalesce(task_status_override, task_status)) stored,
  effective_due_at timestamptz generated always as (coalesce(due_at_override, due_at)) stored,
  search_document tsvector generated always as (to_tsvector('simple', title || ' ' || summary || ' ' || left(body,100000))) stored,
  check ((source = 'hubspot' and portal_id is not null and hubspot_id is not null) or (source = 'tools' and portal_id is null and hubspot_id is null)),
  unique (portal_id, object_type, hubspot_id)
);
create index crm_records_type_time on public.crm_records (object_type, archived, occurred_at desc, id);
create index crm_records_tasks_due on public.crm_records (effective_task_status, effective_due_at, id) where object_type = 'tasks';
create index crm_records_search on public.crm_records using gin (search_document);
create index crm_records_owner on public.crm_records (owner_email);

-- No foreign key on imported links: HubSpot can link to archived or inaccessible records.
create table public.crm_links (
  from_id text not null,
  to_id text not null,
  label text not null default 'associated',
  source text not null check (source in ('hubspot','tools')),
  primary key (from_id, to_id, label, source)
);
create index crm_links_to on public.crm_links (to_id, from_id);

create table public.crm_metadata (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.crm_audit (
  id bigint generated always as identity primary key,
  record_id text not null references public.crm_records(id),
  actor_email text not null,
  action text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

create table public.crm_sync_state (
  portal_id text primary key,
  progress jsonb not null default '{}',
  status text not null default 'idle' check (status in ('idle','running','complete','error')),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create function public.crm_import_page(p_records jsonb, p_links jsonb) returns integer
language plpgsql set search_path = public as $$
declare r jsonb; inserted integer := 0;
begin
  if jsonb_array_length(p_records) > 100 then raise exception 'Page too large'; end if;
  for r in select * from jsonb_array_elements(p_records) loop
    if r->>'source' <> 'hubspot' or r->>'id' <> 'hubspot:' || (r->>'portal_id') || ':' || (r->>'object_type') || ':' || (r->>'hubspot_id') then
      raise exception 'Invalid source record';
    end if;
    insert into crm_records (id,object_type,source,portal_id,hubspot_id,title,summary,body,owner_email,occurred_at,due_at,task_status,archived,properties,property_history,source_created_at,source_updated_at,imported_at)
    values (r->>'id',r->>'object_type','hubspot',r->>'portal_id',r->>'hubspot_id',r->>'title',coalesce(r->>'summary',''),coalesce(r->>'body',''),r->>'owner_email',
      (r->>'occurred_at')::timestamptz,(r->>'due_at')::timestamptz,r->>'task_status',coalesce((r->>'archived')::boolean,false),r->'properties',r->'property_history',
      (r->>'source_created_at')::timestamptz,(r->>'source_updated_at')::timestamptz,now())
    on conflict (id) do update set title=excluded.title,summary=excluded.summary,body=excluded.body,owner_email=excluded.owner_email,
      occurred_at=excluded.occurred_at,due_at=excluded.due_at,task_status=excluded.task_status,archived=excluded.archived,
      properties=excluded.properties,property_history=excluded.property_history,source_created_at=excluded.source_created_at,
      source_updated_at=excluded.source_updated_at,imported_at=now();
    inserted := inserted + 1;
  end loop;
  -- Replace only complete outbound source links for the records in this page.
  delete from crm_links where source='hubspot' and from_id in (select value->>'id' from jsonb_array_elements(p_records));
  insert into crm_links(from_id,to_id,label,source)
    select distinct x->>'from_id',x->>'to_id',coalesce(x->>'label','associated'),'hubspot'
    from jsonb_array_elements(p_links) x
    where x->>'from_id' in (select value->>'id' from jsonb_array_elements(p_records))
    on conflict do nothing;
  return inserted;
end $$;

create function public.crm_create_record(p_id uuid,p_type text,p_title text,p_body text,p_properties jsonb,p_occurred_at timestamptz,p_due_at timestamptz,p_related_id text,p_actor text)
returns text language plpgsql set search_path=public as $$
declare record_id text := 'tools:' || p_id; existing crm_records;
begin
  if length(btrim(p_title)) not between 1 and 300 or length(p_body)>100000 or p_actor is null then raise exception 'Invalid record'; end if;
  if p_type='tasks' and p_due_at is null then raise exception 'Tasks require a due date'; end if;
  if p_related_id is not null and not exists(select 1 from crm_records where id=p_related_id and not archived) then raise exception 'Related record unavailable'; end if;
  select * into existing from crm_records where id=record_id;
  if found then
    if existing.created_by_email<>p_actor then raise exception 'Record already exists'; end if;
    return record_id;
  end if;
  insert into crm_records(id,object_type,source,title,summary,body,owner_email,occurred_at,due_at,task_status,properties,created_by_email)
  values(record_id,p_type,'tools',btrim(p_title),concat_ws(' · ',nullif(p_properties->>'email',''),nullif(p_properties->>'phone',''),nullif(p_properties->>'company','')),p_body,p_actor,p_occurred_at,p_due_at,
    case when p_type='tasks' then 'open' else null end,p_properties,p_actor);
  if p_related_id is not null then
    insert into crm_links(from_id,to_id,label,source) values(record_id,p_related_id,'associated','tools');
  end if;
  insert into crm_audit(record_id,actor_email,action,detail) values(record_id,p_actor,'created',jsonb_build_object('type',p_type,'relatedId',p_related_id));
  return record_id;
end $$;

create function public.crm_update_task(p_id text,p_version integer,p_status text,p_due_at timestamptz,p_actor text,p_can_manage boolean)
returns integer language plpgsql set search_path=public as $$
declare r crm_records;
begin
  select * into r from crm_records where id=p_id and object_type='tasks' and not archived for update;
  if not found then raise exception 'Task unavailable'; end if;
  if r.version<>p_version then raise exception 'Task changed. Refresh before saving.'; end if;
  if not p_can_manage and r.owner_email is distinct from p_actor then raise exception 'Only the task owner or management may update this task'; end if;
  if p_status not in ('open','completed') or p_due_at is null then raise exception 'Status and due date required'; end if;
  update crm_records set task_status_override=p_status,due_at_override=p_due_at,version=version+1,updated_at=now() where id=p_id;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'task_updated',jsonb_build_object('previousStatus',r.effective_task_status,'previousDueAt',r.effective_due_at,'status',p_status,'dueAt',p_due_at));
  return r.version+1;
end $$;

create function public.crm_related_records(p_id text) returns setof public.crm_records
language sql stable set search_path=public as $$
  select * from crm_records where id in (select to_id from crm_links where from_id=p_id union select from_id from crm_links where to_id=p_id)
$$;

create function public.crm_counts() returns table(object_type text,source text,total bigint)
language sql stable set search_path=public as $$
  select object_type,source,count(*) from crm_records where not archived group by object_type,source
$$;

create function public.crm_claim_sync(p_portal text,p_token uuid,p_restart boolean default false) returns jsonb
language plpgsql set search_path=public as $$
declare s crm_sync_state;
begin
  insert into crm_sync_state(portal_id) values(p_portal) on conflict do nothing;
  select * into s from crm_sync_state where portal_id=p_portal for update;
  if s.lease_until>now() then return null; end if;
  if s.status='complete' and not p_restart then return null; end if;
  if s.status in ('idle','complete') then
    s.progress := jsonb_build_object('typeIndex',0,'archived',false,'after',null,'counts','{}'::jsonb,'startedAt',now());
  end if;
  update crm_sync_state set status='running',progress=s.progress,lease_token=p_token,lease_until=now()+interval '5 minutes',last_error=null,updated_at=now() where portal_id=p_portal;
  return s.progress;
end $$;

create function public.crm_commit_sync_page(p_portal text,p_token uuid,p_records jsonb,p_links jsonb,p_progress jsonb,p_complete boolean)
returns void language plpgsql set search_path=public as $$
begin
  perform 1 from crm_sync_state where portal_id=p_portal and lease_token=p_token and lease_until>now() for update;
  if not found then raise exception 'Sync lease expired'; end if;
  if exists(select 1 from jsonb_array_elements(p_records) r where r->>'portal_id'<>p_portal) then raise exception 'Portal mismatch'; end if;
  perform crm_import_page(p_records,p_links);
  update crm_sync_state set progress=p_progress,status=case when p_complete then 'complete' else 'running' end,
    lease_until=case when p_complete then null else now()+interval '5 minutes' end,updated_at=now() where portal_id=p_portal;
end $$;

alter table public.crm_records enable row level security;
alter table public.crm_links enable row level security;
alter table public.crm_metadata enable row level security;
alter table public.crm_audit enable row level security;
alter table public.crm_sync_state enable row level security;
revoke all on public.crm_records,public.crm_links,public.crm_metadata,public.crm_audit,public.crm_sync_state from anon,authenticated;
grant all on public.crm_records,public.crm_links,public.crm_metadata,public.crm_audit,public.crm_sync_state to service_role;
grant usage,select on sequence public.crm_audit_id_seq to service_role;
revoke all on function public.crm_import_page(jsonb,jsonb),public.crm_create_record(uuid,text,text,text,jsonb,timestamptz,timestamptz,text,text),public.crm_update_task(text,integer,text,timestamptz,text,boolean),public.crm_related_records(text),public.crm_counts(),public.crm_claim_sync(text,uuid,boolean),public.crm_commit_sync_page(text,uuid,jsonb,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.crm_import_page(jsonb,jsonb),public.crm_create_record(uuid,text,text,text,jsonb,timestamptz,timestamptz,text,text),public.crm_update_task(text,integer,text,timestamptz,text,boolean),public.crm_related_records(text),public.crm_counts(),public.crm_claim_sync(text,uuid,boolean),public.crm_commit_sync_page(text,uuid,jsonb,jsonb,jsonb,boolean) to service_role;
