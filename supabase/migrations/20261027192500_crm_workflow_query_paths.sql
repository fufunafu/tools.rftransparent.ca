-- Claim small queue rows before reading any CRM source blobs.
alter table public.crm_projection_queue add column priority smallint not null default 1;
update public.crm_projection_queue q set priority=0 from public.crm_records r where r.id=q.record_id and r.object_type='contacts';
create index crm_projection_queue_pick on public.crm_projection_queue(priority,queued_at,record_id);
create or replace function public.crm_queue_projection() returns trigger language plpgsql set search_path=public as $$
begin
  insert into crm_projection_queue(record_id,priority) values(new.id,case when new.object_type='contacts' then 0 else 1 end)
    on conflict(record_id) do update set revision=nextval('public.crm_projection_revision'),queued_at=now(),lease_token=null,lease_until=null,priority=excluded.priority;
  return new;
end $$;
create or replace function public.crm_claim_projections(p_token uuid,p_limit integer default 50) returns table(record_id text,revision bigint,record jsonb)
language sql set search_path=public as $$
  with picked as (select q.record_id from crm_projection_queue q where q.lease_until is null or q.lease_until<now() order by q.priority,q.queued_at,q.record_id for update skip locked limit least(greatest(p_limit,1),100)),
  claimed as (update crm_projection_queue q set lease_token=p_token,lease_until=now()+interval '5 minutes' from picked p where q.record_id=p.record_id returning q.record_id,q.revision)
  select c.record_id,c.revision,jsonb_build_object('id',r.id,'object_type',r.object_type,'source',r.source,'portal_id',r.portal_id,'archived',r.archived,'properties',r.properties,'local_fields',r.local_fields,'body_preview',left(r.body,500))
    from claimed c cross join lateral (select * from crm_records r where r.id=c.record_id limit 1) r;
$$;

-- A SET search_path function cannot be inlined. Returning complete CRM rows
-- here used to load source properties/history before outer filters or paging.
create view public.crm_record_summaries with (security_invoker=true) as
select id,object_type,source,portal_id,hubspot_id,title,summary,owner_email,occurred_at,effective_due_at,effective_task_status,archived,version,created_by_email,reminder_enabled,reminder_minutes,view_fields,local_fields
from public.crm_records;
revoke all on public.crm_record_summaries from public,anon,authenticated;
grant select on public.crm_record_summaries to service_role;
create function public.crm_related_summaries(p_id text,p_search text default '') returns setof public.crm_record_summaries
language sql stable set search_path=public as $$
  select s.* from crm_record_summaries s where s.id in (
    select r.id from crm_records r where r.id in (select to_id from crm_links where from_id=p_id union select from_id from crm_links where to_id=p_id)
      and (p_search='' or strpos(lower(r.title),lower(p_search))>0 or strpos(lower(r.summary),lower(p_search))>0
        or strpos(lower(coalesce(r.local_fields->>'title','')),lower(p_search))>0
        or strpos(lower(coalesce(r.local_fields->>'email','')),lower(p_search))>0
        or strpos(lower(coalesce(r.local_fields->>'phone','')),lower(p_search))>0
        or strpos(lower(coalesce(r.local_fields->>'company','')),lower(p_search))>0
        or r.search_document @@ websearch_to_tsquery('simple',p_search))
  );
$$;
revoke all on function public.crm_related_summaries(text,text) from public,anon,authenticated;
grant execute on function public.crm_related_summaries(text,text) to service_role;
