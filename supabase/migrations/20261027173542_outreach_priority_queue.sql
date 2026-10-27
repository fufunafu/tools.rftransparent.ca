begin;
set local lock_timeout = '5s';

-- Classifications and cheap delivery events must not consume the small budget
-- reserved for replies that may need Instantly email API requests.
create function public.outreach_claim_lane(p_limit integer default 25, p_lane text default 'fast', p_event_id uuid default null)
returns setof public.outreach_events language plpgsql set search_path=public,pg_temp as $$
begin
  if p_lane not in ('fast','reply') then raise exception 'Invalid outreach lane'; end if;
  update outreach_events set status='failed',error_code='lease_expired',locked_until=null
    where status='processing' and locked_until<now() and attempts>=5;
  return query with candidates as (
    select id from outreach_events
    where attempts<5 and available_at<=now()
      and (status='pending' or (status='processing' and locked_until<now()))
      and ((p_lane='reply' and event_type='reply_received') or (p_lane='fast' and event_type<>'reply_received'))
      and (p_event_id is null or id=p_event_id)
    order by case when event_type='email_sent' then 1 else 0 end,occurred_at,created_at,id
    for update skip locked limit greatest(1,least(p_limit,25))
  ) update outreach_events e set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),locked_until=now()+interval '3 minutes'
    from candidates c where e.id=c.id returning e.*;
end $$;
revoke all on function public.outreach_claim_lane(integer,text,uuid) from public,anon,authenticated;
grant execute on function public.outreach_claim_lane(integer,text,uuid) to service_role;
commit;
