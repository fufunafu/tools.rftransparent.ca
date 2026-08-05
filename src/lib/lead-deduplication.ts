import { sanitizePhone } from "@/lib/call-metrics";
import type { Lead, LeadSubmission } from "@/lib/customer-service/leads";

export interface ConsolidatedLead extends Lead {
  duplicate_count: number;
  duplicate_ids: string[];
}

function normalizedEmail(value: string | null): string | null {
  const email = value?.replace(/\s+/g, "").toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

function normalizedPhone(value: string | null): string | null {
  const phone = sanitizePhone(value);
  return phone && phone.length >= 10 ? phone : null;
}

function sameContact(left: Lead, right: Lead): boolean {
  const leftPhone = normalizedPhone(left.phone);
  const rightPhone = normalizedPhone(right.phone);
  if (leftPhone && rightPhone && leftPhone === rightPhone) return true;

  const leftEmail = normalizedEmail(left.email);
  const rightEmail = normalizedEmail(right.email);
  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail);
}

function workflowScore(lead: Lead): number {
  const outcomeScore = {
    new: 0,
    contacted: 100,
    quoted: 300,
    lost: 400,
    not_applicable: 450,
    won: 500,
  }[lead.outcome];
  const callScore = lead.call_status === "called" ? 40 : lead.call_status === "no_answer" ? 20 : 0;
  const quoteScore = lead.quote_number ? 80 : 0;
  const dataScore = [lead.name, lead.email, lead.phone, lead.message, lead.assigned_to]
    .filter((value) => typeof value === "string" && value.trim()).length;
  return outcomeScore + callScore + quoteScore + dataScore;
}

function latestNonEmpty(
  leads: Lead[],
  read: (lead: Lead) => string | null,
): string | null {
  for (let index = leads.length - 1; index >= 0; index--) {
    const value = read(leads[index]);
    if (value?.trim()) return value;
  }
  return null;
}

function bestCallStatus(leads: Lead[]): Lead["call_status"] {
  if (leads.some((lead) => lead.call_status === "called")) return "called";
  if (leads.some((lead) => lead.call_status === "no_answer")) return "no_answer";
  return "not_called";
}

function bestOutcome(leads: Lead[]): Lead["outcome"] {
  const rank: Record<Lead["outcome"], number> = {
    new: 0,
    contacted: 1,
    quoted: 2,
    lost: 3,
    not_applicable: 4,
    won: 5,
  };
  return [...leads].sort((left, right) => rank[right.outcome] - rank[left.outcome])[0].outcome;
}

function earliestDate(leads: Lead[], read: (lead: Lead) => string | null | undefined): string | null {
  const values = leads.map(read).filter((value): value is string => Boolean(value));
  return values.sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
}

function latestDate(leads: Lead[], read: (lead: Lead) => string | null | undefined): string | null {
  const values = leads.map(read).filter((value): value is string => Boolean(value));
  return values.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function toSubmission(lead: Lead): LeadSubmission {
  return {
    id: lead.id,
    source: lead.source,
    source_detail: lead.source_detail,
    form_id: lead.form_id,
    page_url: lead.page_url,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    message: lead.message,
    raw_payload: lead.raw_payload,
    submitted_at: lead.submitted_at,
  };
}

function mergeGroup(group: Lead[]): ConsolidatedLead {
  const chronological = [...group].sort(
    (left, right) => new Date(left.submitted_at).getTime() - new Date(right.submitted_at).getTime(),
  );
  const canonical = [...group].sort((left, right) => {
    const scoreDifference = workflowScore(right) - workflowScore(left);
    if (scoreDifference !== 0) return scoreDifference;
    return new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime();
  })[0];
  const quoteLead = [...group]
    .filter((lead) => lead.quote_number)
    .sort((left, right) => workflowScore(right) - workflowScore(left))[0];
  const latestCallAt = latestDate(group, (lead) => lead.last_call_at);
  const latestCallLead = latestCallAt
    ? group.find((lead) => lead.last_call_at === latestCallAt)
    : undefined;

  return {
    ...canonical,
    source: chronological[0].source,
    source_detail: chronological[0].source_detail,
    form_id: chronological[0].form_id,
    page_url: chronological[0].page_url,
    raw_payload: chronological[0].raw_payload,
    name: canonical.name || latestNonEmpty(chronological, (lead) => lead.name),
    email: canonical.email || latestNonEmpty(chronological, (lead) => lead.email),
    phone: canonical.phone || latestNonEmpty(chronological, (lead) => lead.phone),
    message: canonical.message || latestNonEmpty(chronological, (lead) => lead.message),
    submitted_at: chronological[0].submitted_at,
    call_status: bestCallStatus(group),
    outcome: bestOutcome(group),
    quote_number: quoteLead?.quote_number ?? canonical.quote_number,
    quote_amount: quoteLead?.quote_amount ?? canonical.quote_amount,
    quote_sent_at: quoteLead?.quote_sent_at ?? canonical.quote_sent_at,
    first_quote_at: earliestDate(group, (lead) => lead.first_quote_at ?? lead.quote_sent_at),
    assigned_to: quoteLead?.assigned_to ?? canonical.assigned_to
      ?? latestNonEmpty(chronological, (lead) => lead.assigned_to),
    call_attempts_count: group.reduce((sum, lead) => sum + (lead.call_attempts_count ?? 0), 0),
    first_call_at: earliestDate(group, (lead) => lead.first_call_at),
    last_call_at: latestCallAt,
    last_called_by: latestCallLead?.last_called_by ?? canonical.last_called_by,
    duplicate_count: group.length,
    duplicate_ids: group.map((lead) => lead.id),
    ...(group.length > 1 ? { submissions: chronological.map(toSubmission) } : {}),
  };
}

/**
 * Combine submissions sharing either a normalized phone number or email into
 * one customer-level lead, regardless of source or form. The strongest
 * workflow row remains canonical while every original submission stays
 * available in the detail panel.
 */
export function consolidateDuplicateLeads(leads: Lead[]): ConsolidatedLead[] {
  const chronological = [...leads].sort(
    (left, right) => new Date(left.submitted_at).getTime() - new Date(right.submitted_at).getTime(),
  );
  const groups: Lead[][] = [];

  for (const lead of chronological) {
    const group = groups.find((candidate) => candidate.some((member) => sameContact(member, lead)));

    if (group) group.push(lead);
    else groups.push([lead]);
  }

  return groups
    .map(mergeGroup)
    .sort((left, right) => new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime());
}
