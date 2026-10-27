begin;
set local lock_timeout = '5s';

-- Keep the outreach queue independent of website/Meta leads. Existing IDs and
-- the original update RPC remain valid for older clients during deployment.
alter table public.outreach_leads
  add column contact_name text not null default '',
  add column phone text not null default '',
  add column profile_synced_at timestamptz,
  add column call_count integer not null default 0,
  add column last_call_at timestamptz,
  add column last_called_by text,
  add column last_called_by_name text,
  add column last_call_result text,
  add column quote_number text,
  add column quote_amount numeric(14,2),
  add column quote_currency text,
  add column quote_url text,
  add column quote_sent_at timestamptz,
  add column quoted_by text,
  add column quoted_by_name text;

create table public.outreach_lead_activity (
  id uuid primary key,
  lead_id uuid not null references public.outreach_leads(id),
  kind text not null check (kind in ('call','quote','note')),
  actor_email text not null,
  actor_name text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  note text not null default '',
  call_result text check (call_result in ('connected','no_answer','voicemail','wrong_number')),
  quote_number text,
  quote_amount numeric(14,2) check (quote_amount >= 0),
  quote_currency text check (quote_currency in ('USD','CAD')),
  quote_url text,
  next_follow_up_at timestamptz,
  next_action text,
  check (length(note) <= 4000),
  check (kind <> 'call' or call_result is not null),
  check (kind <> 'quote' or (length(btrim(quote_number)) > 0 and quote_currency is not null)),
  check (kind <> 'note' or length(btrim(note)) > 0)
);
create index outreach_lead_activity_timeline on public.outreach_lead_activity(lead_id, occurred_at desc, id);
alter table public.outreach_lead_activity enable row level security;
revoke all on public.outreach_lead_activity from public, anon, authenticated;
grant all on public.outreach_lead_activity to service_role;

create function public.outreach_lead_sync_profile(p_id uuid,p_email text,p_campaign uuid,p_company text,p_name text,p_phone text)
returns void language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts; k outreach_cases; changed boolean;
begin
  select contact_id into l.contact_id from outreach_leads where id=p_id;
  select * into c from outreach_contacts where id=l.contact_id for update;
  select * into l from outreach_leads where id=p_id for update;
  select * into k from outreach_cases where id=l.case_id;
  if l.id is null or c.email is distinct from p_email or k.provider_campaign_id is distinct from p_campaign or p_campaign is null then
    raise exception 'Profile identity mismatch';
  end if;
  if p_company is null or p_name is null or p_phone is null or length(p_company)>500 or length(p_name)>200 or length(p_phone)>60 then raise exception 'Invalid profile'; end if;
  changed := (coalesce(c.company_name,'')='' and p_company<>'') or (l.contact_name='' and p_name<>'') or (l.phone='' and p_phone<>'');
  update outreach_contacts set company_name=case when coalesce(company_name,'')='' then nullif(p_company,'') else company_name end where id=c.id;
  update outreach_leads set contact_name=case when contact_name='' then p_name else contact_name end,
    phone=case when phone='' then p_phone else phone end,profile_synced_at=now(),
    version=version+case when changed then 1 else 0 end,
    updated_at=case when changed then now() else updated_at end where id=p_id;
end $$;
revoke all on function public.outreach_lead_sync_profile(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.outreach_lead_sync_profile(uuid,text,uuid,text,text,text) to service_role;

create function public.outreach_lead_save(
  p_id uuid,p_version integer,p_actor text,p_stage text,p_due timestamptz,
  p_action text,p_note text,p_claim boolean,p_contact_name text,p_phone text
) returns void language plpgsql set search_path=public,pg_temp as $$
begin
  if p_contact_name is null or p_phone is null or length(p_contact_name)>200 or length(p_phone)>60 then
    raise exception 'Invalid contact details';
  end if;
  perform outreach_lead_update(p_id,p_version,p_actor,p_stage,p_due,p_action,p_note,p_claim);
  update outreach_leads set contact_name=btrim(p_contact_name),phone=btrim(p_phone) where id=p_id;
  insert into outreach_audit(contact_id,actor_email,action,detail)
    select contact_id,p_actor,'lead_contact_saved',jsonb_build_object('leadId',p_id,'contactName',btrim(p_contact_name),'phone',btrim(p_phone))
    from outreach_leads where id=p_id;
end $$;

create function public.outreach_lead_log_activity(
  p_id uuid,p_version integer,p_request_id uuid,p_actor text,p_actor_name text,
  p_kind text,p_at timestamptz,p_note text,p_call_result text,
  p_quote_number text,p_quote_amount numeric,p_quote_currency text,p_quote_url text,
  p_due timestamptz,p_action text
) returns void language plpgsql set search_path=public,pg_temp as $$
declare l outreach_leads; c outreach_contacts; previous outreach_lead_activity;
begin
  -- Match the contact-first locking order used by the webhook and inbox workers.
  select contact_id into l.contact_id from outreach_leads where id=p_id;
  select * into c from outreach_contacts where id=l.contact_id for update;
  select * into l from outreach_leads where id=p_id for update;
  if l.id is null then raise exception 'Lead unavailable'; end if;
  select * into previous from outreach_lead_activity where id=p_request_id;
  if previous.id is not null then
    if previous.lead_id=p_id and previous.actor_email=lower(p_actor) and previous.kind=p_kind
      and previous.occurred_at=p_at and previous.note=btrim(p_note)
      and previous.call_result is not distinct from p_call_result
      and previous.quote_number is not distinct from nullif(btrim(p_quote_number),'')
      and previous.quote_amount is not distinct from p_quote_amount
      and previous.quote_currency is not distinct from p_quote_currency
      and previous.quote_url is not distinct from p_quote_url
      and previous.next_follow_up_at is not distinct from p_due
      and previous.next_action is not distinct from nullif(btrim(p_action),'') then return; end if;
    raise exception 'Activity request already used';
  end if;
  if l.version<>p_version then raise exception 'Lead changed. Refresh before saving.'; end if;
  if c.suppressed_at is not null or l.stage='suppressed' then raise exception 'Contact is suppressed'; end if;
  if p_kind not in ('call','quote','note') or p_kind is null
    or p_actor is null or length(btrim(p_actor))<3 or p_actor_name is null or length(p_actor_name)>200
    or p_at is null or p_at>now()+interval '5 minutes' or p_at<'2000-01-01'::timestamptz
    or p_note is null or length(p_note)>4000 then raise exception 'Invalid activity'; end if;
  if p_kind in ('call','quote') and l.stage in ('won','lost') then raise exception 'Reopen lead before recording activity'; end if;
  if p_kind in ('call','quote') and (p_due is null or p_action is null or length(btrim(p_action))<3 or length(p_action)>1000) then
    raise exception 'Next action and date required';
  end if;
  if p_kind='call' and (p_call_result is null or p_call_result not in ('connected','no_answer','voicemail','wrong_number')) then raise exception 'Call result required'; end if;
  if p_kind='quote' and (p_quote_number is null or length(btrim(p_quote_number))=0 or length(p_quote_number)>120
    or p_quote_currency is null or p_quote_currency not in ('USD','CAD')
    or p_quote_amount<0 or p_quote_amount>=1000000000000
    or (p_quote_url is not null and (length(p_quote_url)>2000 or p_quote_url !~ '^https?://'))) then raise exception 'Invalid quote'; end if;
  if p_kind='note' and length(btrim(p_note))=0 then raise exception 'Note required'; end if;

  insert into outreach_lead_activity(id,lead_id,kind,actor_email,actor_name,occurred_at,note,call_result,quote_number,quote_amount,quote_currency,quote_url,next_follow_up_at,next_action)
  values(p_request_id,p_id,p_kind,lower(p_actor),p_actor_name,p_at,btrim(p_note),
    case when p_kind='call' then p_call_result end,
    case when p_kind='quote' then btrim(p_quote_number) end,
    case when p_kind='quote' then p_quote_amount end,
    case when p_kind='quote' then p_quote_currency end,
    case when p_kind='quote' then p_quote_url end,
    case when p_kind<>'note' then p_due end,
    case when p_kind<>'note' then btrim(p_action) end);

  if p_kind='call' then
    update outreach_leads set call_count=call_count+1,
      last_call_at=case when last_call_at is null or p_at>=last_call_at then p_at else last_call_at end,
      last_called_by=case when last_call_at is null or p_at>=last_call_at then lower(p_actor) else last_called_by end,
      last_called_by_name=case when last_call_at is null or p_at>=last_call_at then p_actor_name else last_called_by_name end,
      last_call_result=case when last_call_at is null or p_at>=last_call_at then p_call_result else last_call_result end,
      stage=case when stage='new' and p_call_result='connected' then 'contacted' else stage end
      where id=p_id;
  elsif p_kind='quote' then
    update outreach_leads set quote_number=btrim(p_quote_number),quote_amount=p_quote_amount,quote_currency=p_quote_currency,
      quote_url=p_quote_url,quote_sent_at=p_at,quoted_by=lower(p_actor),quoted_by_name=p_actor_name,
      stage='quote_sent'
      where id=p_id and (quote_sent_at is null or p_at>=quote_sent_at);
  end if;
  update outreach_leads set version=version+1,updated_at=now(),
    owner_email=case when p_kind='note' then owner_email else coalesce(owner_email,lower(p_actor)) end,
    next_follow_up_at=case when p_kind='note' then next_follow_up_at else p_due end,
    next_action=case when p_kind='note' then next_action else btrim(p_action) end where id=p_id;
  update outreach_contacts set paused=true,updated_at=now(),
    owner_email=case when p_kind='note' then owner_email else coalesce(owner_email,lower(p_actor)) end where id=c.id;
  insert into outreach_audit(contact_id,actor_email,action,detail) values(c.id,lower(p_actor),'lead_activity_logged',
    jsonb_build_object('leadId',p_id,'activityId',p_request_id,'kind',p_kind,'nextAction',p_action,'nextFollowUpAt',p_due));
end $$;

revoke all on function public.outreach_lead_save(uuid,integer,text,text,timestamptz,text,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.outreach_lead_log_activity(uuid,integer,uuid,text,text,text,timestamptz,text,text,text,numeric,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.outreach_lead_save(uuid,integer,text,text,timestamptz,text,text,boolean,text,text),
  public.outreach_lead_log_activity(uuid,integer,uuid,text,text,text,timestamptz,text,text,text,numeric,text,text,timestamptz,text) to service_role;
commit;
