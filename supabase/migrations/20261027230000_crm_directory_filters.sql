-- Compact, service-only directory queries. Source blobs and history are excluded.
create view public.crm_directory with (security_invoker=true) as
select id,object_type,source,portal_id,hubspot_id,title,summary,owner_email,occurred_at,
  effective_due_at,effective_task_status,archived,version,created_by_email,
  reminder_enabled,reminder_minutes,view_fields,local_fields,search_document,
  lower(btrim(coalesce(nullif(local_fields->>'title',''),title))) as directory_name,
  lower(btrim(coalesce(owner_email,''))) as filter_owner,
  lower(btrim(coalesce(local_fields->>'stage',view_fields->>'stage',''))) as filter_stage,
  lower(btrim(coalesce(local_fields->>'country',view_fields->>'country',''))) as filter_country,
  lower(btrim(coalesce(local_fields->>'region',view_fields->>'region',''))) as filter_region,
  lower(btrim(coalesce(local_fields->>'city',view_fields->>'city',''))) as filter_city,
  case when local_fields ? 'stage' and local_fields->>'stage' is distinct from view_fields->>'stage'
    then local_fields->>'stage'
    else coalesce(nullif(view_fields->>'stage_label',''),view_fields->>'stage','') end as stage_label
from public.crm_records where object_type in ('contacts','companies');
revoke all on public.crm_directory from public,anon,authenticated;
grant select on public.crm_directory to service_role;

create index crm_directory_owner on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(owner_email,'')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');
create index crm_directory_stage on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(local_fields->>'stage',view_fields->>'stage','')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');
create index crm_directory_country on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(local_fields->>'country',view_fields->>'country','')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');
create index crm_directory_region on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(local_fields->>'region',view_fields->>'region','')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');
create index crm_directory_city on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(local_fields->>'city',view_fields->>'city','')))),occurred_at desc nulls last,id)
  where object_type in ('contacts','companies');
create index crm_directory_name on public.crm_records
  (object_type,archived,(lower(btrim(coalesce(nullif(local_fields->>'title',''),title)))),id)
  where object_type in ('contacts','companies');

-- Options come from the complete directory, never just the current page.
create function public.crm_directory_filter_options(p_type text,p_archived boolean default false)
returns jsonb language plpgsql stable set search_path=public as $$
declare result jsonb;
begin
  if p_type not in ('contacts','companies') or p_type is null or p_archived is null then
    raise exception 'Invalid directory';
  end if;
  with base as materialized (
    select filter_owner,filter_stage,filter_country,filter_region,filter_city,stage_label,
      coalesce(local_fields->>'country',view_fields->>'country','') country_label,
      coalesce(local_fields->>'region',view_fields->>'region','') region_label,
      coalesce(local_fields->>'city',view_fields->>'city','') city_label
    from crm_directory where object_type=p_type and archived=p_archived
  ), counts as (
    select f.field,f.value,coalesce(min(nullif(btrim(f.label),'')),'') label,count(*) total
    from base b cross join lateral (values
      ('owner',b.filter_owner,b.filter_owner),('stage',b.filter_stage,b.stage_label),
      ('country',b.filter_country,b.country_label),('region',b.filter_region,b.region_label),
      ('city',b.filter_city,b.city_label)
    ) f(field,value,label) group by f.field,f.value
  ), grouped as (
    select field,jsonb_agg(jsonb_build_object('value',value,'label',label,'count',total)
      order by (value=''),lower(label),value) options from counts group by field
  ) select jsonb_object_agg(field,options) into result from grouped;
  return jsonb_build_object('owner','[]'::jsonb,'stage','[]'::jsonb,'country','[]'::jsonb,'region','[]'::jsonb,'city','[]'::jsonb)||coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.crm_directory_filter_options(text,boolean) from public,anon,authenticated;
grant execute on function public.crm_directory_filter_options(text,boolean) to service_role;
analyze public.crm_records;
