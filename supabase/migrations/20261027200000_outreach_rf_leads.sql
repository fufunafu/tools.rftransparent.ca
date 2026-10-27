begin;
set local lock_timeout = '5s';

-- The existing outreach workflow stays intact. Its interested tickets also
-- enter the standard RF workflow, where call and quote sync already operate.
alter table public.leads add column outreach_lead_id uuid unique references public.outreach_leads(id);

create function public.outreach_sync_rf_lead(p_id uuid) returns void
language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts; k outreach_cases; e outreach_events; reply text;
begin
  select * into l from outreach_leads where id=p_id;
  if l.id is null then return; end if;
  select * into c from outreach_contacts where id=l.contact_id;
  select * into k from outreach_cases where id=l.case_id;
  select * into e from outreach_events where id=l.interest_event_id;
  select body into reply from outreach_lead_mail
    where lead_id=l.id and direction='inbound' and not automatic
    order by received_at desc, id desc limit 1;
  insert into leads as existing (
    outreach_lead_id,store_id,source,source_detail,name,email,phone,message,
    raw_payload,submitted_at,assigned_to,outcome,not_applicable_reason,lost_reason
  ) values (
    l.id,'rf_transparent','outreach',
    case k.campaign_key when 'materials_sales' then 'Materials outreach' else 'Installer outreach' end,
    coalesce(nullif(l.contact_name,''),c.company_name),c.email,nullif(l.phone,''),
    coalesce(nullif(reply,''),nullif(e.event->>'body',''),'Marked Interested in Instantly'),
    jsonb_build_object('outreach_lead_id',l.id,'campaign',k.campaign_key,
      'campaign_id',k.provider_campaign_id,'interest_event_id',e.id,
      'conversation_ref',e.event->>'threadId'),
    e.occurred_at,l.owner_email,
    case when c.suppressed_at is not null or l.stage='suppressed' then 'not_applicable'
      when l.stage='lost' then 'lost' when l.stage='won' then 'won' else 'new' end,
    case when c.suppressed_at is not null or l.stage='suppressed' then 'Do not contact: outreach suppressed' end,
    case when l.stage='lost' then 'Outreach prospect declined' end
  ) on conflict (outreach_lead_id) do update set
    name=coalesce(nullif(existing.name,''),excluded.name),
    phone=coalesce(nullif(existing.phone,''),excluded.phone),
    message=excluded.message,
    -- RF employees own the standard workflow. A provider refresh must not
    -- reset their call, quote, assignment, notes, or outcome. Stops still win.
    outcome=case when excluded.outcome='not_applicable' then 'not_applicable'
      when l.stage='lost' and existing.outcome in ('new','contacted') then 'lost'
      else existing.outcome end,
    not_applicable_reason=case when excluded.outcome='not_applicable'
      then excluded.not_applicable_reason else existing.not_applicable_reason end,
    lost_reason=case when l.stage='lost' and existing.outcome in ('new','contacted')
      then excluded.lost_reason else existing.lost_reason end;
end $$;

create function public.outreach_rf_lead_handoff() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  perform outreach_sync_rf_lead(new.id);
  return new;
end $$;
create trigger outreach_rf_lead_handoff after insert or update of contact_name,phone,stage,last_reply_at on public.outreach_leads
for each row execute function public.outreach_rf_lead_handoff();

revoke all on function public.outreach_sync_rf_lead(uuid), public.outreach_rf_lead_handoff() from public,anon,authenticated;
grant execute on function public.outreach_sync_rf_lead(uuid), public.outreach_rf_lead_handoff() to service_role;

-- Backfill only positive-interest tickets, never the cold prospect database.
select outreach_sync_rf_lead(id) from outreach_leads order by created_at,id;
commit;
