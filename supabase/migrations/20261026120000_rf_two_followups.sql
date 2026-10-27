-- Save the outcome, count and history together while locking the quote.
create or replace function public.log_rf_followup(
  p_lead_id uuid,
  p_expected_count integer,
  p_outcome text,
  p_notes text,
  p_logged_by text,
  p_close_reason text
) returns jsonb
language plpgsql
set search_path = public
set timezone = 'UTC'
as $$
declare
  lead public.followup_leads%rowtype;
  terminal boolean := p_outcome in ('won', 'lost', 'duplicate');
  saved_at timestamptz := now();
begin
  if p_outcome is null or p_outcome not in (
    'new', 'hot_lead', 'considering', 'price_shopping', 'future_project',
    'no_answer', 'won', 'lost', 'duplicate'
  ) then
    raise exception 'Invalid outcome';
  end if;

  select * into lead from public.followup_leads
  where id = p_lead_id and store_id = 'store1' for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if lead.followup_count <> p_expected_count then
    raise exception 'This quote changed. Refresh before saving again.' using errcode = '40001';
  end if;
  if not terminal and (lead.followup_count >= 2 or lead.closed_at is not null) then
    raise exception 'No further follow-ups are scheduled.' using errcode = '40001';
  end if;

  update public.followup_leads set
    lead_status = p_outcome,
    followup_count = case when lead.followup_count >= 2 then lead.followup_count else lead.followup_count + 1 end,
    next_followup_at = case when terminal or lead.followup_count >= 1 then null else saved_at + interval '21 days' end,
    closed_at = case when terminal then saved_at else lead.closed_at end,
    close_reason = case when p_outcome = 'lost' then p_close_reason else lead.close_reason end,
    updated_at = saved_at
  where id = lead.id
  returning * into lead;

  insert into public.followup_logs (lead_id, outcome, notes, logged_by, created_at)
  values (lead.id, p_outcome, p_notes, p_logged_by, saved_at);
  return to_jsonb(lead);
end;
$$;

revoke all on function public.log_rf_followup(uuid, integer, text, text, text, text) from public;
grant execute on function public.log_rf_followup(uuid, integer, text, text, text, text) to service_role;

-- Reconcile existing RF quotes with the two-follow-up sequence.
-- Completing the sequence does not classify a quote as lost or change sales.
update public.followup_leads as lead
set next_followup_at = case
  when followup_count >= 2 then null
  when followup_count = 1 then coalesce((
    select max(log.created_at)
    from public.followup_logs as log
    where log.lead_id = lead.id
      and log.logged_by <> 'system'
      and log.outcome in ('new', 'hot_lead', 'considering', 'price_shopping', 'future_project', 'no_answer')
      and (lead.requoted_at is null or log.created_at > lead.requoted_at)
  ), coalesce(greatest(requoted_at, last_invoice_sent_at), shopify_created_at, first_synced_at) + interval '7 days') + interval '21 days'
  else coalesce(greatest(requoted_at, last_invoice_sent_at), shopify_created_at, first_synced_at) + interval '7 days'
end,
updated_at = now()
where store_id = 'store1'
  and closed_at is null
  and lead_status not in ('won', 'lost', 'duplicate');
