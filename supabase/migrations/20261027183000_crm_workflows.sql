-- Additive workflow state. Imported properties, history and associations remain intact.
alter table public.crm_records add column reminder_enabled boolean not null default false;
alter table public.crm_records add column reminder_minutes integer not null default 60 check(reminder_minutes in (15,60,1440));
create index crm_records_reminders on public.crm_records(effective_due_at) where object_type='tasks' and reminder_enabled and not archived and effective_task_status='open';

-- Compact display fields keep source blobs out of the browsing path.
alter table public.crm_records add column view_fields jsonb not null default '{}';
alter table public.crm_records add column local_fields jsonb not null default '{}';
create function public.crm_edit_contact(p_id text,p_version integer,p_fields jsonb,p_actor text)
returns integer language plpgsql set search_path=public as $$
declare r crm_records;
begin
  select * into r from crm_records where id=p_id and object_type='contacts' and not archived for update;
  if not found then raise exception 'Contact unavailable'; end if;
  if r.version<>p_version then raise exception 'Contact changed. Refresh before saving.'; end if;
  if p_actor is null or length(btrim(p_fields->>'title')) not between 1 and 300 or jsonb_typeof(p_fields)<>'object'
    or exists(select 1 from jsonb_object_keys(p_fields) k where k not in ('title','email','phone','company','stage')) then raise exception 'Invalid contact fields'; end if;
  update crm_records set local_fields=local_fields||p_fields,version=version+1,updated_at=now() where id=p_id;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'contact_updated',jsonb_build_object('before',r.local_fields,'after',p_fields));
  return r.version+1;
end $$;

create sequence public.crm_projection_revision;
create table public.crm_projection_queue (
  record_id text primary key references public.crm_records(id) on delete cascade,
  revision bigint not null default nextval('public.crm_projection_revision'),
  lease_token uuid, lease_until timestamptz,
  queued_at timestamptz not null default now()
);
create table public.crm_identities (
  record_id text not null references public.crm_records(id) on delete cascade,
  kind text not null check(kind in ('email','phone')),
  value text not null check(length(value) between 3 and 320),
  primary key(record_id,kind,value)
);
create index crm_identities_match on public.crm_identities(kind,value,record_id);
create table public.crm_duplicate_reviews (
  kind text not null, value text not null, fingerprint text not null,
  decision text not null check(decision in ('duplicate','separate')),
  actor_email text not null, reviewed_at timestamptz not null default now(),
  primary key(kind,value,fingerprint)
);
create table public.crm_assets (
  id text primary key,
  kind text not null check(kind in ('file','recording')), portal_id text not null,
  remote_id text, source_url text,
  status text not null default 'pending' check(status in ('pending','copying','ready','blocked','failed')),
  filename text, content_type text, byte_size bigint, sha256 text, storage_path text,
  attempts integer not null default 0, error_code text,
  lease_token uuid, lease_until timestamptz, retry_at timestamptz,
  created_at timestamptz not null default now(), copied_at timestamptz,
  check(status<>'ready' or (storage_path is not null and sha256 is not null and byte_size is not null))
);
create index crm_assets_pending on public.crm_assets(status,retry_at,created_at);
create table public.crm_record_assets (
  record_id text not null references public.crm_records(id) on delete cascade,
  asset_id text not null references public.crm_assets(id),
  primary key(record_id,asset_id)
);
create index crm_record_assets_asset on public.crm_record_assets(asset_id);
create table public.crm_reminder_deliveries (
  id uuid primary key default gen_random_uuid(), record_id text not null references public.crm_records(id),
  due_at timestamptz not null, owner_email text not null,
  kind text not null check(kind in ('upcoming','overdue')),
  status text not null default 'pending' check(status in ('pending','sending','sent','cancelled','failed')),
  -- Freeze the message on first claim so a provider retry uses identical content.
  title text not null, first_attempt_at timestamptz, sent_at timestamptz,
  attempts integer not null default 0, error_code text, provider_id text,
  lease_token uuid, lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(record_id,due_at,owner_email,kind)
);
create index crm_reminders_pending on public.crm_reminder_deliveries(status,created_at);

create function public.crm_queue_projection() returns trigger language plpgsql set search_path=public as $$
begin
  if new.object_type in ('contacts','calls','emails','notes','meetings','tasks','tickets','deals','companies') then
    insert into crm_projection_queue(record_id) values(new.id)
      on conflict(record_id) do update set revision=nextval('public.crm_projection_revision'),queued_at=now(),lease_token=null,lease_until=null;
  end if;
  return new;
end $$;
create trigger crm_projection_changed after insert or update of properties,archived,local_fields on public.crm_records
  for each row execute function public.crm_queue_projection();
insert into public.crm_projection_queue(record_id) select id from public.crm_records;

create function public.crm_task_reminder_default() returns trigger language plpgsql set search_path=public as $$
begin
  if new.source='tools' then
    new.view_fields:=jsonb_build_object('email',coalesce(new.properties->>'email',''),'phone',coalesce(new.properties->>'phone',''),'company',coalesce(new.properties->>'company',''),'stage',coalesce(new.properties->>'lifecyclestage',''),'preview',left(new.body,500));
  end if;
  if new.object_type='tasks' and new.source='tools' then
    new.reminder_enabled := coalesce((new.properties->>'reminder_enabled')::boolean,false);
    new.reminder_minutes := coalesce((new.properties->>'reminder_minutes')::integer,60);
  end if;
  return new;
end $$;
create trigger crm_task_reminder_default before insert on public.crm_records for each row execute function public.crm_task_reminder_default();

create function public.crm_update_task_settings(p_id text,p_version integer,p_status text,p_due_at timestamptz,p_actor text,p_can_manage boolean,p_reminder_enabled boolean,p_reminder_minutes integer)
returns integer language plpgsql set search_path=public as $$
declare next_version integer;
begin
  if p_reminder_minutes not in (15,60,1440) or p_reminder_enabled is null then raise exception 'Invalid reminder settings'; end if;
  next_version := crm_update_task(p_id,p_version,p_status,p_due_at,p_actor,p_can_manage);
  update crm_records set reminder_enabled=p_reminder_enabled,reminder_minutes=p_reminder_minutes where id=p_id;
  insert into crm_audit(record_id,actor_email,action,detail) values(p_id,p_actor,'reminder_updated',jsonb_build_object('enabled',p_reminder_enabled,'minutes',p_reminder_minutes));
  return next_version;
end $$;

create function public.crm_claim_projections(p_token uuid,p_limit integer default 50) returns table(record_id text,revision bigint,record jsonb)
language sql set search_path=public as $$
  with picked as (select q.record_id from crm_projection_queue q join crm_records r on r.id=q.record_id where q.lease_until is null or q.lease_until<now() order by (r.object_type='contacts') desc,q.queued_at,q.record_id for update of q skip locked limit least(greatest(p_limit,1),100)),
  claimed as (update crm_projection_queue q set lease_token=p_token,lease_until=now()+interval '5 minutes' from picked p where q.record_id=p.record_id returning q.record_id,q.revision)
  select c.record_id,c.revision,jsonb_build_object('id',r.id,'object_type',r.object_type,'source',r.source,'portal_id',r.portal_id,'archived',r.archived,'properties',r.properties,'local_fields',r.local_fields,'body_preview',left(r.body,500))
    from claimed c join crm_records r on r.id=c.record_id;
$$;
create function public.crm_commit_projections(p_token uuid,p_rows jsonb) returns integer language plpgsql set search_path=public as $$
declare item jsonb; asset jsonb; n integer:=0;
begin
  if jsonb_array_length(p_rows)>100 then raise exception 'Batch too large'; end if;
  for item in select * from jsonb_array_elements(p_rows) loop
    -- Same lock order as the source trigger. A later import cannot be erased by an old projection.
    perform 1 from crm_records where id=item->>'record_id' for update;
    perform 1 from crm_projection_queue where record_id=item->>'record_id' and revision=(item->>'revision')::bigint and lease_token=p_token and lease_until>now() for update;
    if not found then continue; end if;
    update crm_records set view_fields=coalesce(item->'view_fields','{}') where id=item->>'record_id';
    delete from crm_identities where record_id=item->>'record_id';
    insert into crm_identities(record_id,kind,value) select item->>'record_id',x->>'kind',x->>'value' from jsonb_array_elements(item->'identities') x on conflict do nothing;
    for asset in select * from jsonb_array_elements(item->'assets') loop
      insert into crm_assets(id,kind,portal_id,remote_id,source_url) values(asset->>'id',asset->>'kind',asset->>'portal_id',asset->>'remote_id',asset->>'source_url') on conflict do nothing;
      insert into crm_record_assets(record_id,asset_id) values(item->>'record_id',asset->>'id') on conflict do nothing;
    end loop;
    delete from crm_projection_queue where record_id=item->>'record_id' and revision=(item->>'revision')::bigint;
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.crm_duplicate_groups(p_reviewed boolean default false,p_offset integer default 0)
returns table(kind text,value text,fingerprint text,total bigint,records jsonb,decision text,reviewed_by text)
language sql stable set search_path=public as $$
  with groups as (
    select i.kind,i.value,md5(string_agg(i.record_id,',' order by i.record_id)) fingerprint,count(*) total
    from crm_identities i join crm_records r on r.id=i.record_id where not r.archived and r.object_type='contacts'
    group by i.kind,i.value having count(*)>1
  ), selected as (
    select g.*,v.decision,v.actor_email reviewed_by from groups g left join crm_duplicate_reviews v using(kind,value,fingerprint)
    where (v.decision is not null)=p_reviewed order by g.kind,g.value limit 30 offset least(greatest(p_offset,0),100000)
  )
  select s.kind,s.value,s.fingerprint,s.total,
    (select jsonb_agg(to_jsonb(rec)) from (select r.id,r.title,r.summary,r.source from crm_identities i join crm_records r on r.id=i.record_id where i.kind=s.kind and i.value=s.value and not r.archived order by r.id limit 20) rec),s.decision,s.reviewed_by
  from selected s order by s.kind,s.value;
$$;
create function public.crm_review_duplicate(p_kind text,p_value text,p_fingerprint text,p_decision text,p_actor text)
returns void language plpgsql set search_path=public as $$
declare current_fingerprint text;
begin
  select md5(string_agg(i.record_id,',' order by i.record_id)) into current_fingerprint from crm_identities i join crm_records r on r.id=i.record_id
    where i.kind=p_kind and i.value=p_value and not r.archived having count(*)>1;
  if current_fingerprint is distinct from p_fingerprint then raise exception 'Group changed. Refresh before reviewing.'; end if;
  if p_decision='reopen' then
    delete from crm_duplicate_reviews where kind=p_kind and value=p_value and fingerprint=p_fingerprint;
  else
    insert into crm_duplicate_reviews(kind,value,fingerprint,decision,actor_email) values(p_kind,p_value,p_fingerprint,p_decision,p_actor)
      on conflict(kind,value,fingerprint) do update set decision=excluded.decision,actor_email=excluded.actor_email,reviewed_at=now();
  end if;
end $$;

create function public.crm_claim_reminders(p_token uuid,p_limit integer default 20) returns setof public.crm_reminder_deliveries
language plpgsql set search_path=public as $$
begin
  insert into crm_reminder_deliveries(record_id,due_at,owner_email,kind,title)
  select r.id,r.effective_due_at,r.owner_email,case when r.effective_due_at>now() then 'upcoming' else 'overdue' end,r.title
  from crm_records r where r.object_type='tasks' and not r.archived and r.effective_task_status='open' and r.reminder_enabled
    and r.owner_email is not null and r.effective_due_at<=now()+r.reminder_minutes*interval '1 minute'
  on conflict(record_id,due_at,owner_email,kind) do nothing;
  update crm_reminder_deliveries d set status='cancelled',error_code='task_changed' where d.status in ('pending','sending') and not exists(
    select 1 from crm_records r where r.id=d.record_id and not r.archived and r.effective_task_status='open' and r.reminder_enabled
      and r.effective_due_at=d.due_at and r.owner_email=d.owner_email and (d.kind='overdue' or r.effective_due_at>now())
  );
  -- Resend guarantees an idempotency key for 24 hours. Never retry beyond that window.
  update crm_reminder_deliveries set status='failed',error_code='delivery_unconfirmed' where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours';
  return query with picked as (
    select id from crm_reminder_deliveries where status in ('pending','sending') and (lease_until is null or lease_until<now()) and attempts<10
    order by created_at,id for update skip locked limit least(greatest(p_limit,1),50)
  ) update crm_reminder_deliveries d set status='sending',lease_token=p_token,lease_until=now()+interval '5 minutes',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) from picked p where d.id=p.id returning d.*;
end $$;
create function public.crm_finish_reminder(p_id uuid,p_token uuid,p_status text,p_error text default null,p_provider_id text default null)
returns boolean language plpgsql set search_path=public as $$
begin
  if p_status not in ('sent','pending','cancelled','failed') then raise exception 'Invalid status'; end if;
  update crm_reminder_deliveries set status=p_status,error_code=p_error,provider_id=p_provider_id,
    sent_at=case when p_status='sent' then now() else sent_at end,lease_token=null,
    lease_until=case when p_status='pending' then now()+interval '5 minutes' else null end
  where id=p_id and lease_token=p_token and status='sending';
  return found;
end $$;

create function public.crm_claim_assets(p_token uuid,p_limit integer default 5) returns setof public.crm_assets language sql set search_path=public as $$
  with picked as (select id from crm_assets where ((status in ('pending','failed') and (retry_at is null or retry_at<now())) or (status='copying' and lease_until<now())) and attempts<5 order by (kind='recording') desc,created_at,id for update skip locked limit least(greatest(p_limit,1),20))
  update crm_assets a set status='copying',lease_token=p_token,lease_until=now()+interval '10 minutes',attempts=attempts+1 from picked p where a.id=p.id returning a.*;
$$;
create function public.crm_finish_asset(p_id text,p_token uuid,p_result jsonb) returns boolean language plpgsql set search_path=public as $$
begin
  if p_result->>'status' not in ('ready','blocked','failed') then raise exception 'Invalid asset result'; end if;
  update crm_assets set status=p_result->>'status',error_code=p_result->>'error_code',filename=p_result->>'filename',content_type=p_result->>'content_type',
    byte_size=(p_result->>'byte_size')::bigint,sha256=p_result->>'sha256',storage_path=p_result->>'storage_path',
    copied_at=case when p_result->>'status'='ready' then now() else null end,lease_token=null,lease_until=null,retry_at=now()+interval '1 hour'
  where id=p_id and lease_token=p_token and status='copying';
  return found;
end $$;

-- All routes revalidate CRM department access. Browser roles cannot query these tables or RPCs.
do $$ declare t text; f regprocedure; begin
  foreach t in array array['crm_projection_queue','crm_identities','crm_duplicate_reviews','crm_assets','crm_record_assets','crm_reminder_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy service_role_all on public.%I for all to service_role using(true) with check(true)',t);
  end loop;
  grant usage on sequence public.crm_projection_revision to service_role;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('crm_edit_contact','crm_queue_projection','crm_task_reminder_default','crm_update_task_settings','crm_claim_projections','crm_commit_projections','crm_duplicate_groups','crm_review_duplicate','crm_claim_reminders','crm_finish_reminder','crm_claim_assets','crm_finish_asset') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
