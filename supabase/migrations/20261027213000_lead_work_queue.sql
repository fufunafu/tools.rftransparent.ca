begin;
set local lock_timeout = '5s';
alter table public.leads
  add column next_follow_up_at timestamptz,
  add column next_action text,
  add column last_reply_at timestamptz,
  add column last_staff_reply_at timestamptz,
  add column workflow_updated_at timestamptz,
  add column first_quote_at timestamptz,
  add column quote_draft_id text;
create index leads_follow_up_due on public.leads(next_follow_up_at)
  where outcome in ('new','contacted','quoted');

-- Only newly recorded send dates seed first-response timing. Existing draft
-- creation timestamps are intentionally not copied into first_quote_at.
create function public.leads_workflow_defaults() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.quote_sent_at is not null and (TG_OP='INSERT' or new.quote_sent_at is distinct from old.quote_sent_at or new.first_quote_at is distinct from old.first_quote_at) then
    new.first_quote_at=least(new.first_quote_at,new.quote_sent_at);
  end if;
  if new.outcome in ('won','lost','not_applicable') then new.next_follow_up_at=null; end if;
  return new;
end $$;
create trigger leads_workflow_defaults before insert or update of quote_sent_at,first_quote_at,outcome,next_follow_up_at on public.leads
for each row execute function public.leads_workflow_defaults();
revoke all on function public.leads_workflow_defaults() from public,anon,authenticated;
grant execute on function public.leads_workflow_defaults() to service_role;

create or replace function public.outreach_sync_rf_lead(p_id uuid) returns void
language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts; k outreach_cases; e outreach_events; reply text; inbound_at timestamptz; outbound_at timestamptz;
begin
  select * into l from outreach_leads where id=p_id;
  if l.id is null then return; end if;
  select * into c from outreach_contacts where id=l.contact_id;
  select * into k from outreach_cases where id=l.case_id;
  select * into e from outreach_events where id=l.interest_event_id;
  select body into reply from outreach_lead_mail
    where lead_id=l.id and direction='inbound' and not automatic
    order by received_at desc, id desc limit 1;
  select max(received_at) filter (where direction='inbound'),
    max(received_at) filter (where direction='outbound') into inbound_at,outbound_at
    from outreach_lead_mail where lead_id=l.id and not automatic and received_at>=e.occurred_at;
  l.last_reply_at=greatest(l.last_reply_at,inbound_at);
  l.last_staff_reply_at=greatest(l.last_staff_reply_at,outbound_at);
  insert into leads as existing (
    outreach_lead_id,store_id,source,source_detail,name,email,phone,message,
    raw_payload,submitted_at,assigned_to,outcome,not_applicable_reason,lost_reason,
    next_follow_up_at,next_action,last_reply_at,last_staff_reply_at
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
    case when l.stage='lost' then 'Outreach prospect declined' end,
    l.next_follow_up_at,l.next_action,l.last_reply_at,l.last_staff_reply_at
  ) on conflict (outreach_lead_id) do update set
    name=coalesce(nullif(existing.name,''),excluded.name),
    phone=coalesce(nullif(existing.phone,''),excluded.phone),
    message=excluded.message,
    assigned_to=coalesce(nullif(existing.assigned_to,''),excluded.assigned_to),
    last_reply_at=excluded.last_reply_at,
    last_staff_reply_at=excluded.last_staff_reply_at,
    next_follow_up_at=case
      when excluded.outcome in ('not_applicable','lost','won') or existing.outcome in ('not_applicable','lost','won') then null
      when existing.workflow_updated_at is null then excluded.next_follow_up_at
      when excluded.last_reply_at > existing.workflow_updated_at
        and excluded.last_reply_at > coalesce(excluded.last_staff_reply_at,'-infinity'::timestamptz)
        then excluded.last_reply_at
      else existing.next_follow_up_at end,
    next_action=case
      when existing.workflow_updated_at is null then excluded.next_action
      when excluded.last_reply_at > existing.workflow_updated_at
        and excluded.last_reply_at > coalesce(excluded.last_staff_reply_at,'-infinity'::timestamptz)
        then 'Reply to the new prospect message'
      else existing.next_action end,
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


drop trigger outreach_rf_lead_handoff on public.outreach_leads;
create trigger outreach_rf_lead_handoff after insert or update of contact_name,phone,stage,owner_email,last_reply_at,last_staff_reply_at,next_follow_up_at,next_action on public.outreach_leads
for each row execute function public.outreach_rf_lead_handoff();
-- Mail may arrive after a delayed ticket was created, with an older received_at.
-- Refresh from persisted conversation history even when the legacy ticket skips it.
create function public.outreach_rf_mail_handoff() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  perform outreach_sync_rf_lead(new.lead_id);
  return new;
end $$;
revoke all on function public.outreach_rf_mail_handoff() from public,anon,authenticated;
grant execute on function public.outreach_rf_mail_handoff() to service_role;
create trigger outreach_rf_mail_handoff after insert on public.outreach_lead_mail
for each row execute function public.outreach_rf_mail_handoff();
select outreach_sync_rf_lead(id) from outreach_leads order by created_at,id;
commit;
