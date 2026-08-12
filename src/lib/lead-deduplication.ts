import { sanitizePhone } from "@/lib/call-metrics";
import {
  HISTORICAL_UNKNOWN_REASON,
  type Lead,
  type LeadSubmission,
} from "@/lib/customer-service/leads";

const CONSOLIDATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
    installation_requested: lead.installation_requested,
    raw_payload: lead.raw_payload,
    submitted_at: lead.submitted_at,
    attachments: lead.attachments,
  };
}

function isHistoricalImport(lead: Lead): boolean {
  if (lead.not_applicable_reason === HISTORICAL_UNKNOWN_REASON) return true;
  const marker = lead.raw_payload?.historical_import;
  return typeof marker === "object" && marker !== null && !Array.isArray(marker);
}

function canJoinGroup(
  group: Lead[],
  lead: Lead,
  mergeHistoricalAcrossTime: boolean,
): boolean {
  const matching = group.filter((member) => sameContact(member, lead));
  if (matching.length === 0) return false;

  // Historical imports are supporting records for a real operational lead,
  // even when the imported submission date is much older.
  if (mergeHistoricalAcrossTime && isHistoricalImport(lead)) return true;
  const operationalMatches = matching.filter((member) => !isHistoricalImport(member));
  if (mergeHistoricalAcrossTime && operationalMatches.length === 0) return true;

  const leadTime = new Date(lead.submitted_at).getTime();
  const comparisonMatches = operationalMatches.length > 0 ? operationalMatches : matching;
  const latestMatchingTime = Math.max(...comparisonMatches.map(
    (member) => new Date(member.submitted_at).getTime(),
  ));
  if (!Number.isFinite(leadTime) || !Number.isFinite(latestMatchingTime)) return false;
  return leadTime - latestMatchingTime <= CONSOLIDATION_WINDOW_MS;
}

function mergeGroup(group: Lead[]): ConsolidatedLead {
  const chronological = [...group].sort(
    (left, right) => new Date(left.submitted_at).getTime() - new Date(right.submitted_at).getTime(),
  );
  const operational = group.filter((lead) => !isHistoricalImport(lead));
  const workflowGroup = operational.length > 0 ? operational : group;
  const workflowChronological = [...workflowGroup].sort(
    (left, right) => new Date(left.submitted_at).getTime() - new Date(right.submitted_at).getTime(),
  );
  const canonical = [...workflowGroup].sort((left, right) => {
    const scoreDifference = workflowScore(right) - workflowScore(left);
    if (scoreDifference !== 0) return scoreDifference;
    return new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime();
  })[0];
  const quoteLead = [...workflowGroup]
    .filter((lead) => lead.quote_number)
    .sort((left, right) => workflowScore(right) - workflowScore(left))[0];
  // Calls can be linked to a historical duplicate when it was the newest row
  // for that phone number at sync time. Include those calls only when their
  // activity began after the current lifecycle. Older calls belong to the
  // customer's previous inquiry and must not mark a new lead as called.
  const workflowStartedAt = new Date(workflowChronological[0].submitted_at).getTime();
  const callGroup = operational.length === 0
    ? group
    : group.filter((lead) => {
        if (!isHistoricalImport(lead)) return true;
        const firstCallAt = new Date(lead.first_call_at ?? "").getTime();
        return Number.isFinite(workflowStartedAt)
          && Number.isFinite(firstCallAt)
          && firstCallAt >= workflowStartedAt;
      });
  const latestCallAt = latestDate(callGroup, (lead) => lead.last_call_at);
  const latestCallLead = latestCallAt
    ? callGroup.find((lead) => lead.last_call_at === latestCallAt)
    : undefined;

  return {
    ...canonical,
    source: workflowChronological[0].source,
    source_detail: workflowChronological[0].source_detail,
    form_id: workflowChronological[0].form_id,
    page_url: workflowChronological[0].page_url,
    raw_payload: workflowChronological[0].raw_payload,
    name: canonical.name || latestNonEmpty(chronological, (lead) => lead.name),
    email: canonical.email || latestNonEmpty(chronological, (lead) => lead.email),
    phone: canonical.phone || latestNonEmpty(chronological, (lead) => lead.phone),
    message: canonical.message || latestNonEmpty(chronological, (lead) => lead.message),
    installation_requested: group.some((lead) => lead.installation_requested === true)
      ? true
      : group.some((lead) => lead.installation_requested === false)
        ? false
        : null,
    submitted_at: workflowChronological[0].submitted_at,
    call_status: bestCallStatus(callGroup),
    outcome: bestOutcome(workflowGroup),
    quote_number: quoteLead?.quote_number ?? canonical.quote_number,
    quote_amount: quoteLead?.quote_amount ?? canonical.quote_amount,
    quote_sent_at: quoteLead?.quote_sent_at ?? canonical.quote_sent_at,
    first_quote_at: earliestDate(workflowGroup, (lead) => lead.first_quote_at ?? lead.quote_sent_at),
    assigned_to: quoteLead?.assigned_to ?? canonical.assigned_to
      ?? latestNonEmpty(workflowChronological, (lead) => lead.assigned_to),
    call_attempts_count: callGroup.reduce((sum, lead) => sum + (lead.call_attempts_count ?? 0), 0),
    first_call_at: earliestDate(callGroup, (lead) => lead.first_call_at),
    last_call_at: latestCallAt,
    last_called_by: latestCallLead?.last_called_by ?? canonical.last_called_by,
    duplicate_count: group.length,
    duplicate_ids: group.map((lead) => lead.id),
    ...(group.length > 1 ? { submissions: chronological.map(toSubmission) } : {}),
  };
}

/**
 * Combine likely duplicate submissions sharing a normalized phone number or
 * email within one seven-day lead lifecycle. A later inquiry starts a new
 * lead so returning customers remain visible in recent queues and analytics.
 * Historical imports may still attach to their matching operational lead.
 */
export function consolidateDuplicateLeads(
  leads: Lead[],
  options: { mergeHistoricalAcrossTime?: boolean } = {},
): ConsolidatedLead[] {
  const chronological = [...leads].sort(
    (left, right) => new Date(left.submitted_at).getTime() - new Date(right.submitted_at).getTime(),
  );
  const groups: Lead[][] = [];

  for (const lead of chronological) {
    const matchingGroups = groups.filter((group) => canJoinGroup(
      group,
      lead,
      options.mergeHistoricalAcrossTime !== false,
    ));
    if (matchingGroups.length === 0) {
      groups.push([lead]);
      continue;
    }

    const primary = matchingGroups[0];
    primary.push(lead);
    for (const matchingGroup of matchingGroups.slice(1)) {
      primary.push(...matchingGroup);
      groups.splice(groups.indexOf(matchingGroup), 1);
    }
  }

  return groups
    .map(mergeGroup)
    .sort((left, right) => new Date(right.submitted_at).getTime() - new Date(left.submitted_at).getTime());
}
