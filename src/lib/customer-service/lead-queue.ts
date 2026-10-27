import type { Lead } from './leads';

export const isOpenLead = (lead: Pick<Lead, 'outcome'>) => !['won', 'lost', 'not_applicable'].includes(lead.outcome);
export function hasUnansweredReply(lead: Lead): boolean {
  return Boolean(lead.last_reply_at && Date.parse(lead.last_reply_at) > Date.parse(lead.last_staff_reply_at ?? '1970-01-01'));
}
export function isFollowUpDue(lead: Lead, now: number): boolean {
  return isOpenLead(lead) && Boolean(lead.next_follow_up_at && Date.parse(lead.next_follow_up_at) <= now);
}
export function compareLeadPriority(a: Lead, b: Lead, now: number): number {
  const rank = (lead: Lead) => !isOpenLead(lead) ? 5 : isFollowUpDue(lead, now) ? 0
    : hasUnansweredReply(lead) ? 1 : lead.call_status === 'not_called' ? 2 : 3;
  const difference = rank(a) - rank(b);
  if (difference) return difference;
  if (isFollowUpDue(a, now) && isFollowUpDue(b, now)) return Date.parse(a.next_follow_up_at!) - Date.parse(b.next_follow_up_at!);
  return Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
}
export function leadMatchesOwner(lead: Lead, filter: string, email: string): boolean {
  if (filter === 'unassigned') return !lead.assigned_to?.trim();
  if (filter === 'mine') return Boolean(email && lead.assigned_to?.trim().toLowerCase() === email.toLowerCase());
  return true;
}
