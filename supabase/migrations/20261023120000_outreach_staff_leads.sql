begin;
set local lock_timeout = '5s';

create table public.outreach_leads (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.outreach_cases(id),
  contact_id uuid not null references public.outreach_contacts(id),
  interest_event_id uuid not null references public.outreach_events(id),
  stage text not null default 'new' check (stage in ('new','contacted','qualifying','quote_sent','follow_up','won','lost','suppressed')),
  owner_email text,
  next_follow_up_at timestamptz default now(),
  next_action text not null default 'Reply to the interested prospect in the general inbox',
  notes text not null default '',
  version integer not null default 1,
  last_reply_at timestamptz,
  last_staff_reply_at timestamptz,
  mail_synced_at timestamptz,
  mail_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outreach_leads_due on public.outreach_leads(next_follow_up_at) where stage not in ('won','lost','suppressed');
alter table public.outreach_leads enable row level security;
revoke all on public.outreach_leads from public, anon, authenticated;
grant all on public.outreach_leads to service_role;

-- Only Instantly's positive classification opens a ticket. A raw prospect or
-- an unclassified reply stays out of this queue. Unique case identity makes
-- label retries and concurrent deliveries converge on the same ticket.
create function public.outreach_staff_handoff() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare c outreach_contacts; k outreach_cases; ticket uuid;
begin
  if new.status not in ('processed','held') or old.status in ('processed','held') then return new; end if;
  select * into c from outreach_contacts where id = new.contact_id for update;
  select * into k from outreach_cases where contact_id=c.id and campaign_key=new.campaign_key;
  if new.event_type='lead_not_interested' and k.last_event_at<=new.occurred_at then
    update outreach_leads set stage='lost',next_follow_up_at=null,next_action='Prospect declined',version=version+1,updated_at=now()
      where case_id=k.id and stage not in ('won','lost','suppressed');
  end if;
  if c.suppressed_at is not null or k.id is null or k.stage in ('declined','suppressed')
     or k.last_event_at > new.occurred_at then return new; end if;
  if new.event_type in ('lead_interested','rf_installer_interested','rf_quote_requested') then
    insert into outreach_leads(case_id,contact_id,interest_event_id,owner_email,last_reply_at)
      values(k.id,c.id,new.id,c.owner_email,null)
      on conflict(case_id) do nothing returning id into ticket;
    if ticket is not null then
      update outreach_contacts set paused=true, updated_at=now() where id=c.id;
      insert into outreach_audit(contact_id,actor_email,action,detail)
        values(c.id,'system','interested_lead_created',jsonb_build_object('leadId',ticket,'eventId',new.id));
    end if;
  elsif new.event_type='reply_received' then
    update outreach_leads set last_reply_at=new.occurred_at, next_follow_up_at=now(),
      next_action='Read the new reply in the general inbox', version=version+1, updated_at=now()
      where case_id=k.id and stage not in ('won','lost','suppressed')
        and (last_reply_at is null or last_reply_at<new.occurred_at);
  end if;
  return new;
end $$;
create trigger outreach_staff_handoff after update of status on public.outreach_events
  for each row execute function public.outreach_staff_handoff();

create function public.outreach_staff_stop() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.suppressed_at is not null and old.suppressed_at is null then
    update outreach_leads set stage='suppressed',next_follow_up_at=null,
      next_action='Do not contact',version=version+1,updated_at=now() where contact_id=new.id;
  end if;
  return new;
end $$;
create trigger outreach_staff_stop after update of suppressed_at on public.outreach_contacts
  for each row execute function public.outreach_staff_stop();

create function public.outreach_lead_update(p_id uuid,p_version integer,p_actor text,p_stage text,p_due timestamptz,p_action text,p_note text,p_claim boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts;
begin
  select contact_id into l.contact_id from outreach_leads where id=p_id;
  select * into c from outreach_contacts where id=l.contact_id for update;
  select * into l from outreach_leads where id=p_id for update;
  if l.id is null or l.version<>p_version then raise exception 'Lead changed. Refresh before saving.'; end if;
  if c.suppressed_at is not null or l.stage='suppressed' then raise exception 'Contact is suppressed'; end if;
  if p_stage not in ('new','contacted','qualifying','quote_sent','follow_up','won','lost')
    or length(btrim(p_actor))<3 or length(p_action)>1000 or length(p_note)>4000 then raise exception 'Invalid update'; end if;
  if p_stage not in ('won','lost') and (p_due is null or length(btrim(p_action))<3) then raise exception 'Next action and date required'; end if;
  update outreach_leads set stage=p_stage,
    owner_email=case when p_claim then lower(p_actor) else owner_email end,
    next_follow_up_at=case when p_stage in ('won','lost') then null else p_due end,
    next_action=p_action,notes=p_note,version=version+1,updated_at=now() where id=p_id;
  update outreach_contacts set paused=true,
    owner_email=case when p_claim then lower(p_actor) else owner_email end,updated_at=now() where id=c.id;
  insert into outreach_audit(contact_id,actor_email,action,detail) values(c.id,p_actor,'lead_updated',
    jsonb_build_object('leadId',p_id,'stage',p_stage,'nextFollowUpAt',p_due,'nextAction',p_action,'note',p_note,'claimed',p_claim));
end $$;
revoke all on function public.outreach_staff_handoff() from public,anon,authenticated;
revoke all on function public.outreach_staff_stop() from public,anon,authenticated;
revoke all on function public.outreach_lead_update(uuid,integer,text,text,timestamptz,text,text,boolean) from public,anon,authenticated;
grant execute on function public.outreach_staff_handoff(), public.outreach_staff_stop(), public.outreach_lead_update(uuid,integer,text,text,timestamptz,text,text,boolean) to service_role;

create table public.outreach_lead_mail (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references outreach_leads(id),
  message_id text not null,
  thread_id text not null,
  direction text not null check(direction in ('inbound','outbound')),
  received_at timestamptz not null,
  subject text not null,
  body text not null,
  automatic boolean not null default false,
  unique(lead_id,message_id)
);
alter table outreach_lead_mail enable row level security;
revoke all on outreach_lead_mail from public,anon,authenticated;
grant all on outreach_lead_mail to service_role;
create function public.outreach_lead_receive_mail(p_lead uuid,p_message text,p_thread text,p_direction text,p_at timestamptz,p_body text,p_subject text,p_automatic boolean,p_stop boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts; inserted uuid;
begin
  select contact_id into l.contact_id from outreach_leads where id=p_lead;
  select * into c from outreach_contacts where id=l.contact_id for update;
  select * into l from outreach_leads where id=p_lead for update;
  if l.id is null then raise exception 'Lead unavailable'; end if;
  insert into outreach_lead_mail(lead_id,message_id,thread_id,direction,received_at,subject,body,automatic)
    values(p_lead,p_message,p_thread,p_direction,p_at,left(p_subject,2000),left(p_body,20000),p_automatic)
    on conflict(lead_id,message_id) do nothing returning id into inserted;
  if inserted is null then return; end if;
  if p_stop and p_direction='inbound' and not p_automatic then
    update outreach_contacts set suppressed_at=coalesce(suppressed_at,now()),suppression_reason=coalesce(suppression_reason,'general_inbox_opt_out'),paused=true where id=c.id;
    update outreach_cases set stage='suppressed' where contact_id=c.id;
    update outreach_tasks set status='cancelled',updated_at=now() where status='open' and case_id in (select id from outreach_cases where contact_id=c.id);
  end if;
  if c.suppressed_at is not null or p_stop or l.stage in ('won','lost','suppressed') or p_automatic then return; end if;
  if p_direction='inbound' and (l.last_reply_at is null or p_at>l.last_reply_at) then
    update outreach_leads set last_reply_at=p_at,next_follow_up_at=now(),next_action='Read the new reply in the general inbox',version=version+1,updated_at=now() where id=p_lead;
  elsif p_direction='outbound' and p_at>=coalesce(l.last_reply_at,l.created_at) and (l.last_staff_reply_at is null or p_at>l.last_staff_reply_at) then
    update outreach_leads set last_staff_reply_at=p_at,stage=case when stage='new' then 'contacted' else stage end,version=version+1,updated_at=now() where id=p_lead;
  end if;
end $$;
revoke all on function public.outreach_lead_receive_mail(uuid,text,text,text,timestamptz,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.outreach_lead_receive_mail(uuid,text,text,text,timestamptz,text,text,boolean,boolean) to service_role;
commit;
