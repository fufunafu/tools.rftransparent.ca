-- Personal ownership for frontline customer-service queues.

alter table public.callback_notes
  add column if not exists assigned_to text;

create index if not exists callback_notes_assigned_to
  on public.callback_notes (assigned_to, status, updated_at desc);

alter table public.followup_leads
  add column if not exists assigned_to text;

create index if not exists followup_leads_assigned_to
  on public.followup_leads (assigned_to, next_followup_at)
  where closed_at is null;
