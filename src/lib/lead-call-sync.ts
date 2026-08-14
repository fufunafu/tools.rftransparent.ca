import { deduplicateRecords, sanitizePhone, type CallRecord } from "@/lib/call-metrics";
import { getSupabase } from "@/lib/supabase";
import { HISTORICAL_UNKNOWN_REASON } from "@/lib/customer-service/leads";

type LeadCallStatus = "not_called" | "no_answer" | "called";

export interface LeadForCallSync {
  id: string;
  email: string | null;
  phone: string | null;
  quote_number: string | null;
  submitted_at: string;
  call_status: LeadCallStatus;
  outcome: "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable";
  not_applicable_reason: string | null;
}

export interface DraftContactForCallSync {
  draft_name: string;
  customer_email: string | null;
  customer_phone: string | null;
}

export interface PhoneCallForLeadSync extends CallRecord {
  store_id: string;
}

export interface MatchedLeadCalls {
  leadId: string;
  status: Exclude<LeadCallStatus, "not_called">;
  attempts: Array<{
    id: string;
    lead_id: string;
    staff: string;
    result: string;
    notes: string;
    called_at: string;
  }>;
}

interface LeadCallMatchPlan {
  matches: MatchedLeadCalls[];
  ambiguousCallIds: string[];
}

export interface LeadCallSyncSummary {
  leadsScanned: number;
  callsScanned: number;
  ambiguousCallsSkipped: number;
  ambiguousAttemptsRemoved: number;
  matchedLeads: number;
  called: number;
  noAnswer: number;
  attemptsSynced: number;
  statusesUpdated: number;
  phonesRecovered: number;
}

const PAGE_SIZE = 1000;
const WRITE_CHUNK_SIZE = 200;

function matchablePhone(raw: string | null): string | null {
  const normalized = sanitizePhone(raw);
  return normalized && normalized.length >= 10 ? normalized : null;
}

function normalizedEmail(raw: string | null): string | null {
  const email = raw?.replace(/\s+/g, "").toLowerCase() ?? "";
  if (!email.includes("@")) return null;
  // Typo tolerance: quotes in an address are almost always a data-entry slip
  // ("bev'scarpentry@…" vs "bevscarpentry@…"). Treating the variants as one
  // identity keeps the ambiguity guard from splitting one person in two and
  // silently skipping every call to their number.
  return email.replace(/['"‘’“”]/g, "");
}

function isHistoricalLead(lead: LeadForCallSync): boolean {
  return lead.not_applicable_reason === HISTORICAL_UNKNOWN_REASON;
}

/**
 * Recover a missing lead phone from its linked Shopify draft. Quote numbers can
 * repeat across stores and years, so the customer email must also match.
 */
export function recoverLeadPhonesFromLinkedQuotes(
  leads: LeadForCallSync[],
  drafts: DraftContactForCallSync[],
): LeadForCallSync[] {
  const draftsByNumber = new Map<string, DraftContactForCallSync[]>();
  for (const draft of drafts) {
    if (!matchablePhone(draft.customer_phone)) continue;
    draftsByNumber.set(draft.draft_name, [
      ...(draftsByNumber.get(draft.draft_name) ?? []),
      draft,
    ]);
  }

  return leads.map((lead) => {
    if (matchablePhone(lead.phone) || !lead.quote_number) return lead;
    const email = normalizedEmail(lead.email);
    if (!email) return lead;
    const draft = (draftsByNumber.get(lead.quote_number) ?? []).find(
      (candidate) => normalizedEmail(candidate.customer_email) === email,
    );
    return draft?.customer_phone ? { ...lead, phone: draft.customer_phone } : lead;
  });
}

function callStatus(call: PhoneCallForLeadSync): Exclude<LeadCallStatus, "not_called"> | null {
  const endpoint = call.endpoint?.toLowerCase() ?? "";
  const voicemail = endpoint.includes("vm");

  if (call.direction === "outbound") {
    return Number(call.duration_min) > 0 && !voicemail ? "called" : "no_answer";
  }
  if (call.direction === "inbound" && call.endpoint && !voicemail && Number(call.duration_min) > 0) {
    return "called";
  }
  return null;
}

function customerPhone(call: PhoneCallForLeadSync): string | null {
  return matchablePhone(call.direction === "outbound" ? call.to_number : call.from_number);
}

function staffLabel(call: PhoneCallForLeadSync): string {
  const endpoint = call.endpoint?.trim();
  if (!endpoint || endpoint.toLowerCase() === "answered" || endpoint.toLowerCase().includes("vm")) {
    return "Phone system";
  }
  return /^\d+$/.test(endpoint) ? `Extension ${endpoint}` : endpoint;
}

function resultLabel(
  call: PhoneCallForLeadSync,
  status: Exclude<LeadCallStatus, "not_called">,
): string {
  if (status === "no_answer") return "No answer";
  return call.direction === "outbound" ? "Outbound call answered" : "Inbound call answered";
}

function sourceLabel(call: PhoneCallForLeadSync): string {
  const source = call.source === "cik" ? "CIK" : call.source === "grasshopper" ? "Grasshopper" : call.source;
  const store = call.store_id === "rf_transparent"
    ? "RF Transparent"
    : call.store_id === "bc_transparent"
      ? "BC Transparent"
      : call.store_id;
  return `${store} via ${source}, ${Number(call.duration_min).toFixed(1)} min`;
}

function latestEligibleLead(
  candidates: Array<LeadForCallSync & { submittedTime: number }>,
  callTime: number,
): LeadForCallSync | null {
  let low = 0;
  let high = candidates.length - 1;
  let match: LeadForCallSync | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candidates[middle].submittedTime <= callTime) {
      match = candidates[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

function preferredEligibleLead(
  candidates: Array<LeadForCallSync & { submittedTime: number }> | undefined,
  callTime: number,
): LeadForCallSync | null {
  if (!candidates) return null;
  const operational = candidates.filter((lead) => !isHistoricalLead(lead));
  return latestEligibleLead(operational, callTime)
    ?? latestEligibleLead(candidates, callTime);
}

function hasMultipleEligibleEmailIdentities(
  candidates: Array<LeadForCallSync & { submittedTime: number }> | undefined,
  callTime: number,
): boolean {
  if (!candidates) return false;

  const emails = new Set<string>();
  for (const lead of candidates) {
    if (lead.submittedTime > callTime) break;
    const email = normalizedEmail(lead.email);
    if (!email) continue;
    emails.add(email);
    if (emails.size > 1) return true;
  }

  return false;
}

function planPhoneCallMatches(
  leads: LeadForCallSync[],
  calls: PhoneCallForLeadSync[],
): LeadCallMatchPlan {
  const leadsByPhone = new Map<string, Array<LeadForCallSync & { submittedTime: number }>>();
  for (const lead of leads) {
    const phone = matchablePhone(lead.phone);
    const submittedTime = new Date(lead.submitted_at).getTime();
    if (!phone || Number.isNaN(submittedTime)) continue;
    const candidates = leadsByPhone.get(phone) ?? [];
    candidates.push({ ...lead, submittedTime });
    leadsByPhone.set(phone, candidates);
  }
  for (const candidates of leadsByPhone.values()) {
    candidates.sort((a, b) => a.submittedTime - b.submittedTime);
  }

  const matches = new Map<string, MatchedLeadCalls>();
  const ambiguousCallIds: string[] = [];
  const sortedCalls = [...calls].sort(
    (a, b) => new Date(a.call_start).getTime() - new Date(b.call_start).getTime(),
  );
  for (const call of sortedCalls) {
    const status = callStatus(call);
    const phone = customerPhone(call);
    const callTime = new Date(call.call_start).getTime();
    if (!status || !phone || Number.isNaN(callTime)) continue;

    const candidates = leadsByPhone.get(phone);
    if (hasMultipleEligibleEmailIdentities(candidates, callTime)) {
      ambiguousCallIds.push(call.id);
      continue;
    }

    const lead = preferredEligibleLead(candidates, callTime);
    if (!lead) continue;

    const current = matches.get(lead.id) ?? {
      leadId: lead.id,
      status,
      attempts: [],
    };
    if (status === "called") current.status = "called";
    current.attempts.push({
      id: call.id,
      lead_id: lead.id,
      staff: staffLabel(call),
      result: resultLabel(call, status),
      notes: sourceLabel(call),
      called_at: call.call_start,
    });
    matches.set(lead.id, current);
  }

  return { matches: [...matches.values()], ambiguousCallIds };
}

export function matchPhoneCallsToLeads(
  leads: LeadForCallSync[],
  calls: PhoneCallForLeadSync[],
): MatchedLeadCalls[] {
  return planPhoneCallMatches(leads, calls).matches;
}

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function updateLeadIds(
  ids: string[],
  update: Record<string, unknown>,
  outcome?: "new",
): Promise<void> {
  const supabase = getSupabase();
  for (let offset = 0; offset < ids.length; offset += WRITE_CHUNK_SIZE) {
    let query = supabase
      .from("leads")
      .update(update)
      .in("id", ids.slice(offset, offset + WRITE_CHUNK_SIZE));
    if (outcome) query = query.eq("outcome", outcome);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }
}

async function removeAmbiguousAttempts(
  callIds: string[],
  leadById: Map<string, LeadForCallSync>,
): Promise<{ attemptsRemoved: number; statusesUpdated: number; affectedLeadIds: string[] }> {
  if (callIds.length === 0) {
    return { attemptsRemoved: 0, statusesUpdated: 0, affectedLeadIds: [] };
  }

  const supabase = getSupabase();
  const affectedLeadIds = new Set<string>();
  let attemptsRemoved = 0;

  for (let offset = 0; offset < callIds.length; offset += WRITE_CHUNK_SIZE) {
    const ids = callIds.slice(offset, offset + WRITE_CHUNK_SIZE);
    const { data, error: lookupError } = await supabase
      .from("lead_call_attempts")
      .select("id,lead_id")
      .in("id", ids);
    if (lookupError) throw new Error(lookupError.message);
    if (!data || data.length === 0) continue;

    data.forEach((attempt) => affectedLeadIds.add(attempt.lead_id));
    const { error: deleteError } = await supabase
      .from("lead_call_attempts")
      .delete()
      .in("id", data.map((attempt) => attempt.id));
    if (deleteError) throw new Error(deleteError.message);
    attemptsRemoved += data.length;
  }

  const affectedIds = [...affectedLeadIds];
  if (affectedIds.length === 0) {
    return { attemptsRemoved, statusesUpdated: 0, affectedLeadIds: [] };
  }

  const statusByLead = new Map<string, LeadCallStatus>(
    affectedIds.map((id) => [id, "not_called"]),
  );
  for (let offset = 0; offset < affectedIds.length; offset += WRITE_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("lead_call_attempts")
      .select("lead_id,result")
      .in("lead_id", affectedIds.slice(offset, offset + WRITE_CHUNK_SIZE));
    if (error) throw new Error(error.message);

    for (const attempt of data ?? []) {
      const current = statusByLead.get(attempt.lead_id) ?? "not_called";
      if (attempt.result.trim().toLowerCase() !== "no answer") {
        statusByLead.set(attempt.lead_id, "called");
      } else if (current === "not_called") {
        statusByLead.set(attempt.lead_id, "no_answer");
      }
    }
  }

  let statusesUpdated = 0;
  for (const status of ["not_called", "no_answer", "called"] as const) {
    const ids = affectedIds.filter((id) => (
      statusByLead.get(id) === status && leadById.get(id)?.call_status !== status
    ));
    await updateLeadIds(ids, { call_status: status });
    statusesUpdated += ids.length;
  }

  return { attemptsRemoved, statusesUpdated, affectedLeadIds: affectedIds };
}

export async function syncLeadCallStatuses(): Promise<LeadCallSyncSummary> {
  const supabase = getSupabase();
  const leads = await fetchAllRows<LeadForCallSync>((from, to) =>
    supabase
      .from("leads")
      .select("id,email,phone,quote_number,submitted_at,call_status,outcome,not_applicable_reason")
      .order("submitted_at", { ascending: true })
      .range(from, to),
  );

  if (leads.length === 0) {
    return {
      leadsScanned: 0,
      callsScanned: 0,
      ambiguousCallsSkipped: 0,
      ambiguousAttemptsRemoved: 0,
      matchedLeads: 0,
      called: 0,
      noAnswer: 0,
      attemptsSynced: 0,
      statusesUpdated: 0,
      phonesRecovered: 0,
    };
  }

  const draftContacts = await fetchAllRows<DraftContactForCallSync>((from, to) =>
    supabase
      .from("followup_leads")
      .select("draft_name,customer_email,customer_phone")
      .not("customer_phone", "is", null)
      .order("draft_name", { ascending: true })
      .range(from, to),
  );
  const leadsWithRecoveredPhones = recoverLeadPhonesFromLinkedQuotes(leads, draftContacts);
  const recoveredPhones = leadsWithRecoveredPhones.filter((lead, index) => (
    lead.phone !== leads[index].phone
  ));
  for (let offset = 0; offset < recoveredPhones.length; offset += WRITE_CHUNK_SIZE) {
    const batch = recoveredPhones.slice(offset, offset + WRITE_CHUNK_SIZE);
    const results = await Promise.all(batch.map((lead) =>
      supabase
        .from("leads")
        .update({ phone: lead.phone })
        .eq("id", lead.id),
    ));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
  }

  const earliestLead = leadsWithRecoveredPhones[0].submitted_at;
  const calls = await fetchAllRows<PhoneCallForLeadSync>((from, to) =>
    supabase
      .from("call_records")
      .select("id,store_id,call_start,call_end,from_number,to_number,direction,duration_min,charge,endpoint,source")
      .gte("call_start", earliestLead)
      .order("call_start", { ascending: true })
      .range(from, to),
  );
  const dedupedCalls = deduplicateRecords(calls);
  const { matches, ambiguousCallIds } = planPhoneCallMatches(
    leadsWithRecoveredPhones,
    dedupedCalls,
  );
  const leadById = new Map(leadsWithRecoveredPhones.map((lead) => [lead.id, lead]));

  const attempts = matches.flatMap((match) => match.attempts);
  for (let offset = 0; offset < attempts.length; offset += WRITE_CHUNK_SIZE) {
    const { error } = await supabase
      .from("lead_call_attempts")
      .upsert(attempts.slice(offset, offset + WRITE_CHUNK_SIZE), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  const ambiguityCleanup = await removeAmbiguousAttempts(ambiguousCallIds, leadById);
  const ambiguityAffectedLeads = new Set(ambiguityCleanup.affectedLeadIds);

  const calledIds = matches
    .filter((match) => match.status === "called")
    .map((match) => match.leadId);
  const noAnswerIds = matches
    .filter(
      (match) => match.status === "no_answer"
        && !ambiguityAffectedLeads.has(match.leadId)
        && leadById.get(match.leadId)?.call_status === "not_called",
    )
    .map((match) => match.leadId);
  const calledStatusUpdates = calledIds.filter(
    (id) => !ambiguityAffectedLeads.has(id) && leadById.get(id)?.call_status !== "called",
  );

  await updateLeadIds(calledStatusUpdates, { call_status: "called" });
  await updateLeadIds(calledIds, { outcome: "contacted" }, "new");
  await updateLeadIds(noAnswerIds, { call_status: "no_answer" });

  return {
    leadsScanned: leads.length,
    callsScanned: dedupedCalls.length,
    ambiguousCallsSkipped: ambiguousCallIds.length,
    ambiguousAttemptsRemoved: ambiguityCleanup.attemptsRemoved,
    matchedLeads: matches.length,
    called: matches.filter((match) => match.status === "called").length,
    noAnswer: matches.filter((match) => match.status === "no_answer").length,
    attemptsSynced: attempts.length,
    statusesUpdated: ambiguityCleanup.statusesUpdated
      + calledStatusUpdates.length
      + noAnswerIds.length,
    phonesRecovered: recoveredPhones.length,
  };
}
