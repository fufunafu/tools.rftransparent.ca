-- Maintain exact totals in the same transaction as each record change.
-- The initial lock prevents a bulk-import write from racing the one-time tally.
lock table public.crm_records in share row exclusive mode;
create table public.crm_record_counts (
  object_type text not null,
  source text not null,
  total bigint not null check (total >= 0),
  primary key (object_type, source)
);
insert into public.crm_record_counts(object_type,source,total)
  select object_type,source,count(*) from public.crm_records where not archived group by object_type,source;

create function public.crm_track_record_count() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and old.archived=new.archived and old.object_type=new.object_type and old.source=new.source then
    return new;
  end if;
  if tg_op in ('DELETE','UPDATE') then
    if not old.archived then
      update crm_record_counts set total=total-1 where object_type=old.object_type and source=old.source;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if not new.archived then
      insert into crm_record_counts(object_type,source,total) values(new.object_type,new.source,1)
      on conflict(object_type,source) do update set total=crm_record_counts.total+1;
    end if;
    return new;
  end if;
  return old;
end $$;
create trigger crm_record_count_changed
  after insert or delete or update of archived,object_type,source on public.crm_records
  for each row execute function public.crm_track_record_count();

create or replace function public.crm_counts() returns table(object_type text,source text,total bigint)
language sql stable set search_path=public as $$
  select object_type,source,total from crm_record_counts where total>0
$$;

alter table public.crm_record_counts enable row level security;
revoke all on public.crm_record_counts from public,anon,authenticated;
grant all on public.crm_record_counts to service_role;
revoke all on function public.crm_track_record_count() from public,anon,authenticated;
grant execute on function public.crm_track_record_count() to service_role;
