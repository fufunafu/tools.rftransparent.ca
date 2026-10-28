-- Everyday CRM controls: edit and delete Tools activity, richer tasks, manual
-- associations, pinned activity, team reports and logged exports. Imported
-- properties and history stay intact. Local choices live in local_fields and
-- the new tables, so a later HubSpot import cannot undo them.

-- Re-imports keep Tools deletions and Tools owner assignments. Everything else
-- is identical to the original import.
create or replace function public.crm_import_page(p_records jsonb, p_links jsonb) returns integer
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
    on conflict (id) do update set title=excluded.title,summary=excluded.summary,body=excluded.body,
      owner_email=case when crm_records.local_fields ? 'owner_email' then crm_records.owner_email else excluded.owner_email end,
      occurred_at=excluded.occurred_at,due_at=excluded.due_at,task_status=excluded.task_status,
      archived=(excluded.archived or crm_records.local_fields ? 'deleted_at'),
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

-- Detail keys staff can set on Tools records. Values are short labels.
create function public.crm_valid_details(p_details jsonb) returns boolean
language sql immutable set search_path=public as $$
  select jsonb_typeof(coalesce(p_details,'{}'::jsonb))='object' and not exists(
    select 1 from jsonb_each(coalesce(p_details,'{}'::jsonb)) f
    where f.key not in ('priority','task_type','call_outcome','call_direction','duration_minutes','meeting_outcome','email_direction','stage')
      or jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>120)
$$;

-- Creates a record with its owner, details and up to five associations in one
-- transaction. A retry with the same request id returns the original record.
create function public.crm_create_record_ex(p_id uuid,p_type text,p_title text,p_body text,p_properties jsonb,p_occurred_at timestamptz,
  p_due_at timestamptz,p_related_ids text[],p_actor text,p_owner text,p_details jsonb)
returns text language plpgsql set search_path=public as $$
declare record_id text := 'tools:' || p_id; related text; owner text := lower(btrim(coalesce(p_owner,'')));
begin
  if coalesce(cardinality(p_related_ids),0)>5 then raise exception 'Too many associations'; end if;
  if not crm_valid_details(p_details) then raise exception 'Invalid details'; end if;
  if p_type='tasks' and p_owner is not null and owner='' then raise exception 'Tasks need an owner'; end if;
  if exists(select 1 from crm_records where id=record_id) then
    return crm_create_record(p_id,p_type,p_title,p_body,p_properties,p_occurred_at,p_due_at,p_related_ids[1],p_actor);
  end if;
  perform crm_create_record(p_id,p_type,p_title,p_body,p_properties,p_occurred_at,p_due_at,p_related_ids[1],p_actor);
  if p_owner is not null and owner is distinct from p_actor then
    update crm_records set owner_email=nullif(owner,''),local_fields=local_fields||jsonb_build_object('owner_email',owner) where id=record_id;
  end if;
  if p_details is not null and p_details<>'{}'::jsonb then
    update crm_records set local_fields=local_fields||p_details where id=record_id;
  end if;
  foreach related in array coalesce(p_related_ids[2:],'{}'::text[]) loop
    if related=record_id or not exists(select 1 from crm_records where id=related and not archived) then raise exception 'Related record unavailable'; end if;
    insert into crm_links(from_id,to_id,label,source) values(record_id,related,'associated','tools') on conflict do nothing;
  end loop;
  if (p_owner is not null and owner is distinct from p_actor) or coalesce(p_details,'{}'::jsonb)<>'{}'::jsonb or coalesce(cardinality(p_related_ids),0)>1 then
    insert into crm_audit(record_id,actor_email,action,detail) values(record_id,p_actor,'details_set',
      jsonb_build_object('owner',case when p_owner is null then null else owner end,'details',coalesce(p_details,'{}'::jsonb),'relatedIds',to_jsonb(coalesce(p_related_ids,'{}'::text[]))));
  end if;
  return record_id;
end $$;

-- Logged calls, meetings, emails and notes created by a person in Tools.
-- Imported and automatically captured activity (no creator) stay read-only,
-- because a later import or capture would replace the edit. A blank detail
-- value clears that detail.
create function public.crm_edit_activity(p_id text,p_version integer,p_title text,p_body text,p_occurred_at timestamptz,p_details jsonb,p_actor text,p_can_manage boolean)
returns integer language plpgsql set search_path=public as $$
declare r crm_records;
begin
  select * into r from crm_records where id=p_id and object_type in ('calls','meetings','emails','notes') and not archived for update;
  if not found then raise exception 'Activity unavailable'; end if;
  if r.version is distinct from p_version then raise exception 'Activity changed. Refresh before saving.'; end if;
  if r.source<>'tools' then raise exception 'Imported activity is read-only'; end if;
  if r.created_by_email is null then raise exception 'Captured activity is read-only'; end if;
  if not coalesce(p_can_manage,false) and r.created_by_email is distinct from p_actor then raise exception 'Only the author or management may edit this activity'; end if;
  if p_actor is null or length(btrim(coalesce(p_title,''))) not between 1 and 300 or length(coalesce(p_body,''))>100000 or p_occurred_at is null then raise exception 'Invalid activity'; end if;
  if not crm_valid_details(p_details) then raise exception 'Invalid details'; end if;
  update crm_records set title=btrim(p_title),body=coalesce(p_body,''),occurred_at=p_occurred_at,
    local_fields=local_fields||coalesce(p_details,'{}'::jsonb),view_fields=view_fields||jsonb_build_object('preview',left(coalesce(p_body,''),500)),
    version=version+1,updated_at=now() where id=p_id;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'activity_updated',jsonb_build_object(
    'before',jsonb_build_object('title',r.title,'occurred_at',r.occurred_at,'body',r.body)||(select coalesce(jsonb_object_agg(key,r.local_fields->key),'{}'::jsonb) from jsonb_object_keys(coalesce(p_details,'{}'::jsonb)) key),
    'after',jsonb_build_object('title',btrim(p_title),'occurred_at',p_occurred_at,'body',coalesce(p_body,''))||coalesce(p_details,'{}'::jsonb)));
  return r.version+1;
end $$;

-- Title, notes, owner, priority and type. A null owner keeps the current one,
-- so saving an unassigned task never claims it. Status, due date and
-- reminders keep using crm_update_task_settings.
create function public.crm_update_task_details(p_id text,p_version integer,p_title text,p_body text,p_owner text,p_details jsonb,p_actor text,p_can_manage boolean)
returns integer language plpgsql set search_path=public as $$
declare r crm_records; owner text := lower(btrim(coalesce(p_owner,''))); current_title text;
begin
  select * into r from crm_records where id=p_id and object_type='tasks' and not archived for update;
  if not found then raise exception 'Task unavailable'; end if;
  if r.version is distinct from p_version then raise exception 'Task changed. Refresh before saving.'; end if;
  if not coalesce(p_can_manage,false) and r.owner_email is distinct from p_actor and r.created_by_email is distinct from p_actor then
    raise exception 'Only the task owner, its creator or management may update this task';
  end if;
  if p_actor is null or length(btrim(coalesce(p_title,''))) not between 1 and 300 or length(coalesce(p_body,''))>100000 or (p_owner is not null and owner !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Invalid task'; end if;
  if not crm_valid_details(p_details) or exists(select 1 from jsonb_object_keys(coalesce(p_details,'{}'::jsonb)) k where k not in ('priority','task_type')) then raise exception 'Invalid details'; end if;
  current_title := coalesce(nullif(r.local_fields->>'title',''),r.title);
  if r.source<>'tools' and coalesce(p_body,'') is distinct from r.body then raise exception 'Imported task notes are read-only'; end if;
  if r.source='tools' then
    update crm_records set title=btrim(p_title),body=coalesce(p_body,''),view_fields=view_fields||jsonb_build_object('preview',left(coalesce(p_body,''),500)) where id=p_id;
  elsif btrim(p_title) is distinct from current_title then
    update crm_records set local_fields=local_fields||jsonb_build_object('title',btrim(p_title)) where id=p_id;
  end if;
  if p_owner is not null then
    update crm_records set owner_email=owner,local_fields=local_fields||jsonb_build_object('owner_email',owner) where id=p_id;
  end if;
  update crm_records set local_fields=local_fields||coalesce(p_details,'{}'::jsonb),version=version+1,updated_at=now() where id=p_id;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'task_details_updated',jsonb_build_object(
    'before',jsonb_build_object('title',current_title)
      ||case when p_owner is not null then jsonb_build_object('owner_email',coalesce(r.owner_email,'')) else '{}'::jsonb end
      ||case when coalesce(p_body,'') is distinct from r.body then jsonb_build_object('notes',r.body) else '{}'::jsonb end
      ||(select coalesce(jsonb_object_agg(key,r.local_fields->key),'{}'::jsonb) from jsonb_object_keys(coalesce(p_details,'{}'::jsonb)) key),
    'after',jsonb_build_object('title',btrim(p_title))
      ||case when p_owner is not null then jsonb_build_object('owner_email',owner) else '{}'::jsonb end
      ||case when coalesce(p_body,'') is distinct from r.body then jsonb_build_object('notes',coalesce(p_body,'')) else '{}'::jsonb end
      ||coalesce(p_details,'{}'::jsonb)));
  return r.version+1;
end $$;

-- Soft delete and restore. Tools records: their creator or management.
-- Imported records: management only. Restoring only reverses a Tools delete.
create function public.crm_set_deleted(p_id text,p_version integer,p_deleted boolean,p_actor text,p_can_manage boolean)
returns integer language plpgsql set search_path=public as $$
declare r crm_records;
begin
  select * into r from crm_records where id=p_id for update;
  if not found then raise exception 'Record unavailable'; end if;
  if r.version is distinct from p_version then raise exception 'Record changed. Refresh before saving.'; end if;
  if r.object_type not in ('contacts','companies','tasks','calls','meetings','emails','notes') then raise exception 'This record type cannot be deleted'; end if;
  if p_actor is null or p_deleted is null then raise exception 'Invalid request'; end if;
  if not coalesce(p_can_manage,false) and (r.source<>'tools' or r.created_by_email is distinct from p_actor) then
    raise exception 'Only the creator or management may delete this record';
  end if;
  if p_deleted then
    if r.archived then raise exception 'Record is already archived'; end if;
    update crm_records set archived=true,local_fields=local_fields||jsonb_build_object('deleted_at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'deleted_by',p_actor),
      version=version+1,updated_at=now() where id=p_id;
    delete from crm_pins where activity_id=p_id;
  else
    if not (r.local_fields ? 'deleted_at') then raise exception 'Only records deleted in Tools can be restored'; end if;
    update crm_records set archived=false,local_fields=local_fields-'deleted_at'-'deleted_by',version=version+1,updated_at=now() where id=p_id;
  end if;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,case when p_deleted then 'deleted' else 'restored' end,jsonb_build_object('type',r.object_type,'title',r.title));
  return r.version+1;
end $$;

-- Manual associations between a contact and a company, or between an activity
-- and a contact or company. Only associations added in Tools can be removed.
create function public.crm_link_records(p_from text,p_to text,p_actor text) returns boolean
language plpgsql set search_path=public as $$
declare a crm_records; b crm_records; added integer;
begin
  if p_actor is null or p_from is null or p_to is null or p_from=p_to then raise exception 'Invalid association'; end if;
  select * into a from crm_records where id=p_from and not archived for key share;
  select * into b from crm_records where id=p_to and not archived for key share;
  if a.id is null or b.id is null then raise exception 'Record unavailable'; end if;
  if not ((a.object_type='contacts' and b.object_type='companies') or (a.object_type='companies' and b.object_type='contacts')
    or (a.object_type in ('calls','meetings','emails','notes','tasks') and b.object_type in ('contacts','companies'))) then raise exception 'These records cannot be associated'; end if;
  if exists(select 1 from crm_links where (from_id=p_from and to_id=p_to) or (from_id=p_to and to_id=p_from)) then return false; end if;
  insert into crm_links(from_id,to_id,label,source) values(p_from,p_to,'associated','tools') on conflict do nothing;
  get diagnostics added=row_count;
  insert into crm_audit(record_id,actor_email,action,detail) values
    (p_from,p_actor,'association_added',jsonb_build_object('recordId',p_to,'title',coalesce(nullif(b.local_fields->>'title',''),b.title),'type',b.object_type)),
    (p_to,p_actor,'association_added',jsonb_build_object('recordId',p_from,'title',coalesce(nullif(a.local_fields->>'title',''),a.title),'type',a.object_type));
  return added>0;
end $$;
create function public.crm_unlink_records(p_from text,p_to text,p_actor text) returns integer
language plpgsql set search_path=public as $$
declare removed integer; a crm_records; b crm_records;
begin
  if p_actor is null or p_from is null or p_to is null then raise exception 'Invalid association'; end if;
  select * into a from crm_records where id=p_from;
  select * into b from crm_records where id=p_to;
  if a.id is null or b.id is null then raise exception 'Record unavailable'; end if;
  delete from crm_links where source='tools' and ((from_id=p_from and to_id=p_to) or (from_id=p_to and to_id=p_from));
  get diagnostics removed=row_count;
  if removed=0 then raise exception 'Only associations added in Tools can be removed'; end if;
  delete from crm_pins where (record_id=p_from and activity_id=p_to) or (record_id=p_to and activity_id=p_from);
  insert into crm_audit(record_id,actor_email,action,detail) values
    (p_from,p_actor,'association_removed',jsonb_build_object('recordId',p_to,'title',coalesce(nullif(b.local_fields->>'title',''),b.title),'type',b.object_type)),
    (p_to,p_actor,'association_removed',jsonb_build_object('recordId',p_from,'title',coalesce(nullif(a.local_fields->>'title',''),a.title),'type',a.object_type));
  return removed;
end $$;

-- One pinned activity per record, shown above the timeline.
create table public.crm_pins (
  record_id text primary key references public.crm_records(id) on delete cascade,
  activity_id text not null references public.crm_records(id) on delete cascade,
  pinned_by text not null,
  pinned_at timestamptz not null default now()
);
create index crm_pins_activity on public.crm_pins(activity_id);
create function public.crm_pin_activity(p_record text,p_activity text,p_actor text) returns boolean
language plpgsql set search_path=public as $$
begin
  if p_actor is null or p_record is null then raise exception 'Invalid pin'; end if;
  if not exists(select 1 from crm_records where id=p_record and not archived) then raise exception 'Record unavailable'; end if;
  if p_activity is null then
    delete from crm_pins where record_id=p_record;
    if found then insert into crm_audit(record_id,actor_email,action,detail) values(p_record,p_actor,'unpinned','{}'::jsonb); end if;
    return false;
  end if;
  if not exists(select 1 from crm_records where id=p_activity and not archived and object_type in ('calls','meetings','emails','notes'))
    or not exists(select 1 from crm_links where (from_id=p_record and to_id=p_activity) or (from_id=p_activity and to_id=p_record)) then
    raise exception 'Pin an activity linked to this record';
  end if;
  insert into crm_pins(record_id,activity_id,pinned_by) values(p_record,p_activity,p_actor)
    on conflict(record_id) do update set activity_id=excluded.activity_id,pinned_by=excluded.pinned_by,pinned_at=now();
  insert into crm_audit(record_id,actor_email,action,detail) values(p_record,p_actor,'pinned',jsonb_build_object('activityId',p_activity));
  return true;
end $$;

-- Every CSV download is recorded with its filters and row count.
create table public.crm_exports (
  id bigint generated always as identity primary key,
  actor_email text not null,
  object_type text not null check(object_type in ('contacts','companies')),
  filters jsonb not null default '{}',
  row_count integer not null,
  created_at timestamptz not null default now()
);

-- Team activity for one period. Activity owner is the effective owner
-- (Tools assignment first). Overdue counts are as of now.
create function public.crm_team_report(p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable set search_path=public as $$
declare people jsonb; stages jsonb;
begin
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '367 days' then raise exception 'Invalid report period'; end if;
  -- Three index-friendly reads: dated activity and contacts, tasks completed
  -- with a due date in the period, and open tasks already overdue.
  with owned as (
    select lower(btrim(coalesce(local_fields->>'owner_email',owner_email,''))) owner,object_type,effective_task_status
      from crm_records where object_type in ('calls','emails','meetings','notes','contacts') and not archived and occurred_at>=p_start and occurred_at<p_end
    union all
    select lower(btrim(coalesce(local_fields->>'owner_email',owner_email,''))),object_type,effective_task_status
      from crm_records where object_type='tasks' and not archived and effective_task_status='completed' and effective_due_at>=p_start and effective_due_at<p_end
    union all
    select lower(btrim(coalesce(local_fields->>'owner_email',owner_email,''))),object_type,effective_task_status
      from crm_records where object_type='tasks' and not archived and effective_task_status='open' and effective_due_at<now()
  ), totals as (
    select owner,
      count(*) filter(where object_type='calls') calls,
      count(*) filter(where object_type='emails') emails,
      count(*) filter(where object_type='meetings') meetings,
      count(*) filter(where object_type='notes') notes,
      count(*) filter(where object_type='contacts') contacts,
      count(*) filter(where object_type='tasks' and effective_task_status='completed') tasks_completed,
      count(*) filter(where object_type='tasks' and effective_task_status='open') tasks_overdue
    from owned group by owner
  ) select coalesce(jsonb_agg(to_jsonb(totals) order by (owner=''),owner),'[]'::jsonb) into people from totals;
  select coalesce(jsonb_agg(jsonb_build_object('value',value,'label',label,'count',total) order by total desc,value),'[]'::jsonb) into stages from (
    select filter_stage value,coalesce(min(nullif(stage_label,'')),'') label,count(*) total from crm_directory where object_type='contacts' and not archived group by filter_stage
  ) s;
  return jsonb_build_object('people',people,'stages',stages);
end $$;

alter table public.crm_pins enable row level security;
alter table public.crm_exports enable row level security;
revoke all on public.crm_pins,public.crm_exports from public,anon,authenticated;
grant all on public.crm_pins,public.crm_exports to service_role;
grant usage,select on sequence public.crm_exports_id_seq to service_role;
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
    ('crm_valid_details','crm_create_record_ex','crm_edit_activity','crm_update_task_details','crm_set_deleted','crm_link_records','crm_unlink_records','crm_pin_activity','crm_team_report') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
