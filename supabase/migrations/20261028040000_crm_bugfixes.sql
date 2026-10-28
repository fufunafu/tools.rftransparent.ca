-- The scheduled HubSpot refresh rewrites every imported row. Re-index a record
-- only when its source fields, archive state, or Tools edits actually change,
-- so activity capture is not paused behind a queue of unchanged contacts.
drop trigger if exists crm_projection_changed on public.crm_records;
create trigger crm_projection_inserted after insert on public.crm_records
  for each row execute function public.crm_queue_projection();
create trigger crm_projection_changed after update of properties,archived,local_fields on public.crm_records
  for each row when (old.properties is distinct from new.properties or old.archived is distinct from new.archived
    or old.local_fields is distinct from new.local_fields)
  execute function public.crm_queue_projection();

-- A copy interrupted on its final attempt previously stayed "copying" forever.
-- Mark it failed so it is visible and staff can queue it again.
create or replace function public.crm_claim_assets(p_token uuid,p_limit integer default 5) returns setof public.crm_assets language sql set search_path=public as $$
  update crm_assets set status='failed',error_code='copy_interrupted',lease_token=null,lease_until=null
    where status='copying' and lease_until<now() and attempts>=5;
  with picked as (select id from crm_assets where ((status in ('pending','failed') and (retry_at is null or retry_at<now())) or (status='copying' and lease_until<now())) and attempts<5 order by (kind='recording') desc,created_at,id for update skip locked limit least(greatest(p_limit,1),20))
  update crm_assets a set status='copying',lease_token=p_token,lease_until=now()+interval '10 minutes',attempts=attempts+1 from picked p where a.id=p.id returning a.*;
$$;
