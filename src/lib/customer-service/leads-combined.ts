// TEMPORARY combined Leads + Follow-up view, served at /customer-service/tmp.
//
// Joins website/Meta leads (the `leads` table, deduplicated the same way the
// Leads page does) with sent Shopify quotes (`followup_leads`) into one row per
// customer, then derives a single stage, the next action, and the queue tabs.
// Pure functions only — the API route feeds it data, the dashboard renders the
// result. Server-side use only (imports the phone helpers).

import type { Lead, LeadSource } from "@/lib/customer-service/leads";
import { HISTORICAL_UNKNOWN_REASON } from "@/lib/customer-service/leads";
import type { LeadStoreId } from "@/lib/customer-service/lead-store";
import { isLeadSpamReason } from "@/lib/customer-service/lead-spam";
import type { FollowUpLead } from "@/lib/followup";
import { isCallablePhone, sanitizePhone } from "@/lib/call-metrics";
import { leadResponseTimeMs, medianLeadResponseTimeMs } from "@/lib/lead-response-times";

export type CombinedStage =
  | "new"
  | "contacted"
  | "quoted"
  | "hot_lead"
  | "considering"
  | "price_shopping"
  | "future_project"
  | "no_answer"
  | "won"
  | "lost"
  | "not_applicable"
  | "duplicate";

export type CombinedCallState = "called" | "not_called" | "no_answer" | "not_required" | "no_phone";
export type CombinedSource = LeadSource | "quote";
export type CombinedTab = "todo" | "upcoming" | "addressed" | "awaiting" | "open" | "closed" | "all" | "dupes";
export type NextUrgency = "now" | "today" | "overdue" | "later" | "none";

export interface CombinedNext {
  kind: "call" | "quote" | "followup" | "resolve" | "none";
  label: string;
  urgency: NextUrgency;
  dueAt: string | null;
}

export interface CombinedLeadInfo {
  id: string;
  // Canonical id plus every merged duplicate submission — the Leads PATCH
  // endpoint takes the whole group so all copies move together.
  ids: string[];
  source: LeadSource;
  source_detail: string | null;
  page_url: string | null;
  message: string | null;
  submitted_at: string;
  call_status: Lead["call_status"];
  outcome: Lead["outcome"];
  first_call_at: string | null;
  last_call_at: string | null;
  last_called_by: string | null;
  call_attempts_count: number;
  duplicate_count: number;
  installation_requested: boolean | null;
  not_applicable_reason: string | null;
  lost_reason: string | null;
  notes: string | null;
  assigned_to: string | null;
  quote_number: string | null;
  quote_amount: number | null;
  quote_sent_at: string | null;
  isSpam: boolean;
  isHistorical: boolean;
}

export interface CombinedRow {
  id: string;
  kind: "lead" | "quote";
  name: string;
  email: string | null;
  phone: string | null;
  source: CombinedSource;
  storeId: LeadStoreId;
  receivedAt: string;
  lead: CombinedLeadInfo | null;
  // Newest first. Every quote is attached to exactly one row.
  quotes: FollowUpLead[];
  primaryQuote: FollowUpLead | null;
  stage: CombinedStage;
  callState: CombinedCallState;
  next: CombinedNext;
  attempts: number;
  staff: string | null;
  tabs: CombinedTab[];
  addressedToday: boolean;
  timeToCallMs: number | null;
  timeToQuoteMs: number | null;
}

export interface SourceSplit {
  website: number;
  meta: number;
  quote: number;
}

export interface CombinedSummary {
  needCall: { total: number; over24h: number; split: SourceSplit };
  followupsDue: { total: number; overdue: number; split: SourceSplit };
  newLeads30d: { total: number; split: SourceSplit };
  openQuotes: { count: number; amount: number; split: SourceSplit };
  conversion: { won: number; lost: number; rate: number | null };
  attempts: { average: number | null; quotes: number };
  medianCallMs: number | null;
  medianQuoteMs: number | null;
  spam: number;
}

export interface BuildOptions {
  now: Date;
  // ISO instants for the business day (America/Toronto).
  todayStart: string;
  tomorrowStart: string;
  // followup_leads ids that received a human log today.
  addressedQuoteIds: Set<string>;
  storeId: LeadStoreId;
}

const DAY_MS = 86_400_000;
const CLOSED_QUOTE_STATUSES = new Set(["won", "lost", "duplicate"]);
const CLOSED_STAGES = new Set<CombinedStage>(["won", "lost", "not_applicable", "duplicate"]);
// A lead submitted this long after a quote is still treated as the same
// inquiry (form filled after a phone quote). Anything later is a new inquiry.
const LEAD_AFTER_QUOTE_WINDOW_MS = 30 * DAY_MS;

function normalizedEmail(raw: string | null | undefined): string | null {
  const email = raw?.replace(/\s+/g, "").toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

function normalizedPhone(raw: string | null | undefined): string | null {
  const phone = sanitizePhone(raw ?? null);
  return phone && phone.length >= 10 ? phone : null;
}

function quoteTime(quote: FollowUpLead): number {
  return new Date(quote.shopify_created_at ?? quote.first_synced_at).getTime();
}

function leadTime(lead: Lead): number {
  return new Date(lead.submitted_at).getTime();
}

export function isQuoteOpen(quote: FollowUpLead): boolean {
  return quote.closed_at == null && !CLOSED_QUOTE_STATUSES.has(quote.lead_status);
}

function stageFromQuote(quote: FollowUpLead): CombinedStage {
  switch (quote.lead_status) {
    case "new":
      return "quoted";
    case "hot_lead":
    case "considering":
    case "price_shopping":
    case "future_project":
    case "no_answer":
    case "won":
    case "lost":
    case "duplicate":
      return quote.lead_status;
    default:
      return "quoted";
  }
}

function stageFromLead(lead: Lead): CombinedStage {
  if (lead.outcome === "new" && lead.call_status === "called") return "contacted";
  return lead.outcome;
}

function callStateFromLead(lead: Lead): CombinedCallState {
  if (lead.outcome === "not_applicable") return "not_required";
  if (!lead.phone || !isCallablePhone(lead.phone)) return "no_phone";
  return lead.call_status;
}

function sameContact(lead: Lead, quote: FollowUpLead): boolean {
  const leadEmail = normalizedEmail(lead.email);
  const quoteEmail = normalizedEmail(quote.customer_email);
  if (leadEmail && quoteEmail) return leadEmail === quoteEmail;
  const leadPhone = normalizedPhone(lead.phone);
  const quotePhone = normalizedPhone(quote.customer_phone);
  if (leadPhone && quotePhone) return leadPhone === quotePhone;
  // Neither side has comparable contact info: trust the quote number.
  return !leadEmail && !quoteEmail && !leadPhone && !quotePhone;
}

function pushTo<K>(map: Map<K, Lead[]>, key: K | null, lead: Lead): void {
  if (key == null) return;
  const list = map.get(key);
  if (list) list.push(lead);
  else map.set(key, [lead]);
}

/**
 * Attach every quote to at most one lead. Quote number wins (with a contact
 * cross-check, since #D numbers repeat across Shopify stores), then email,
 * then phone. Among candidates, the most recent lead submitted before the
 * quote is chosen — the same rule the hourly quote sync uses — falling back to
 * the first lead submitted within 30 days after it.
 */
export function assignQuotesToLeads(
  leads: Lead[],
  quotes: FollowUpLead[],
): { byLead: Map<string, FollowUpLead[]>; orphans: FollowUpLead[] } {
  const byEmail = new Map<string, Lead[]>();
  const byPhone = new Map<string, Lead[]>();
  const byQuoteNumber = new Map<string, Lead[]>();
  for (const lead of [...leads].sort((a, b) => leadTime(a) - leadTime(b))) {
    pushTo(byEmail, normalizedEmail(lead.email), lead);
    pushTo(byPhone, normalizedPhone(lead.phone), lead);
    pushTo(byQuoteNumber, lead.quote_number?.trim() || null, lead);
  }

  const byLead = new Map<string, FollowUpLead[]>();
  const orphans: FollowUpLead[] = [];

  for (const quote of [...quotes].sort((a, b) => quoteTime(a) - quoteTime(b))) {
    let candidates = (byQuoteNumber.get(quote.draft_name.trim()) ?? []).filter((lead) =>
      sameContact(lead, quote),
    );
    const email = normalizedEmail(quote.customer_email);
    const phone = normalizedPhone(quote.customer_phone);
    if (candidates.length === 0 && email) candidates = byEmail.get(email) ?? [];
    if (candidates.length === 0 && phone) candidates = byPhone.get(phone) ?? [];

    const at = quoteTime(quote);
    let pick: Lead | null = null;
    for (let index = candidates.length - 1; index >= 0; index--) {
      if (leadTime(candidates[index]) <= at + DAY_MS) {
        pick = candidates[index];
        break;
      }
    }
    if (!pick) {
      pick = candidates.find((lead) => leadTime(lead) - at <= LEAD_AFTER_QUOTE_WINDOW_MS) ?? null;
    }

    if (!pick) {
      orphans.push(quote);
      continue;
    }
    const list = byLead.get(pick.id);
    if (list) list.push(quote);
    else byLead.set(pick.id, [quote]);
  }

  return { byLead, orphans };
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(1, Math.ceil((toMs - fromMs) / DAY_MS));
}

function deriveNext(
  stage: CombinedStage,
  callState: CombinedCallState,
  primary: FollowUpLead | null,
  openQuoteCount: number,
  receivedAt: string,
  opts: BuildOptions,
): CombinedNext {
  const nowMs = opts.now.getTime();
  if (CLOSED_STAGES.has(stage)) return { kind: "none", label: "—", urgency: "none", dueAt: null };

  if (openQuoteCount > 1) {
    return { kind: "resolve", label: "Resolve duplicate quotes", urgency: "today", dueAt: null };
  }

  if (primary && isQuoteOpen(primary)) {
    const due = primary.next_followup_at;
    if (!due) return { kind: "followup", label: "No follow-up scheduled", urgency: "later", dueAt: null };
    const dueMs = new Date(due).getTime();
    if (due < opts.todayStart) {
      // Calendar days in the business timezone, so "due yesterday evening"
      // reads as 1 day overdue rather than a few hours.
      const days = daysBetween(dueMs, new Date(opts.todayStart).getTime());
      return { kind: "followup", label: `${days} day${days === 1 ? "" : "s"} overdue`, urgency: "overdue", dueAt: due };
    }
    if (due < opts.tomorrowStart) {
      return { kind: "followup", label: "Follow-up due today", urgency: "today", dueAt: due };
    }
    const days = daysBetween(nowMs, dueMs);
    const label =
      days <= 14
        ? `In ${days} day${days === 1 ? "" : "s"}`
        : new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { kind: "followup", label, urgency: "later", dueAt: due };
  }

  if (stage === "quoted") {
    // The lead carries a quote number that isn't among the tracked quotes
    // (older than a year, or still an unsent draft).
    return { kind: "none", label: "Quote not tracked", urgency: "none", dueAt: null };
  }

  switch (callState) {
    case "no_phone":
      return { kind: "call", label: "No phone number", urgency: "none", dueAt: null };
    case "not_called": {
      const waitingMs = nowMs - new Date(receivedAt).getTime();
      const label = waitingMs >= DAY_MS ? `Call now · waiting ${Math.floor(waitingMs / DAY_MS)}d` : "Call now";
      return { kind: "call", label, urgency: "now", dueAt: null };
    }
    case "no_answer":
      return { kind: "call", label: "Call again", urgency: "now", dueAt: null };
    case "called":
      return { kind: "quote", label: "Send quote", urgency: "later", dueAt: null };
    default:
      return { kind: "none", label: "—", urgency: "none", dueAt: null };
  }
}

function computeTabs(row: Omit<CombinedRow, "tabs">, openQuoteCount: number): CombinedTab[] {
  if (row.lead?.isSpam) return [];
  const tabs: CombinedTab[] = ["all"];
  const closed = CLOSED_STAGES.has(row.stage);
  if (["now", "today", "overdue"].includes(row.next.urgency)) tabs.push("todo");
  if (row.next.kind === "followup" && row.next.urgency === "later" && row.next.dueAt) tabs.push("upcoming");
  if (row.addressedToday) tabs.push("addressed");
  if (row.stage === "contacted") tabs.push("awaiting");
  if (!closed && (openQuoteCount > 0 || row.stage === "quoted")) tabs.push("open");
  if (closed) tabs.push("closed");
  if (openQuoteCount > 1) tabs.push("dupes");
  return tabs;
}

function leadInfo(lead: Lead): CombinedLeadInfo {
  const isSpam = lead.outcome === "not_applicable" && isLeadSpamReason(lead.not_applicable_reason);
  const isHistorical = lead.outcome === "not_applicable" && lead.not_applicable_reason === HISTORICAL_UNKNOWN_REASON;
  const ids = Array.from(new Set([lead.id, ...(lead.duplicate_ids ?? [])]));
  const quoteAmount = lead.quote_amount == null ? null : Number(lead.quote_amount);
  return {
    id: lead.id,
    ids,
    source: lead.source,
    source_detail: lead.source_detail,
    page_url: lead.page_url,
    message: lead.message,
    submitted_at: lead.submitted_at,
    call_status: lead.call_status,
    outcome: lead.outcome,
    first_call_at: lead.first_call_at ?? null,
    last_call_at: lead.last_call_at ?? null,
    last_called_by: lead.last_called_by ?? null,
    call_attempts_count: lead.call_attempts_count ?? 0,
    duplicate_count: lead.duplicate_count ?? 1,
    installation_requested: lead.installation_requested,
    not_applicable_reason: lead.not_applicable_reason,
    lost_reason: lead.lost_reason,
    notes: lead.notes,
    assigned_to: lead.assigned_to,
    quote_number: lead.quote_number,
    quote_amount: Number.isFinite(quoteAmount) ? quoteAmount : null,
    quote_sent_at: lead.quote_sent_at,
    isSpam,
    isHistorical,
  };
}

function finishRow(base: Omit<CombinedRow, "tabs">, openQuoteCount: number): CombinedRow {
  return { ...base, tabs: computeTabs(base, openQuoteCount) };
}

function leadRow(lead: Lead, attached: FollowUpLead[], opts: BuildOptions): CombinedRow {
  const quotes = [...attached].sort((a, b) => quoteTime(b) - quoteTime(a));
  const openQuotes = quotes.filter(isQuoteOpen);
  const primary = openQuotes[0] ?? quotes[0] ?? null;
  const stage = primary ? stageFromQuote(primary) : stageFromLead(lead);
  const callState = callStateFromLead(lead);
  const info = leadInfo(lead);
  const next = deriveNext(stage, callState, primary, openQuotes.length, lead.submitted_at, opts);
  const firstQuoteAt =
    lead.first_quote_at ?? (quotes.length ? (quotes[quotes.length - 1].shopify_created_at ?? null) : null) ?? lead.quote_sent_at;
  const addressedToday =
    (info.last_call_at != null && info.last_call_at >= opts.todayStart) ||
    quotes.some((quote) => opts.addressedQuoteIds.has(quote.id));

  return finishRow(
    {
      id: lead.id,
      kind: "lead",
      name: lead.name?.trim() || lead.email || lead.phone || "Unknown",
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      storeId: opts.storeId,
      receivedAt: lead.submitted_at,
      lead: info,
      quotes,
      primaryQuote: primary,
      stage,
      callState,
      next,
      attempts: primary?.followup_count ?? 0,
      staff: primary ? primary.last_invoice_sender || primary.created_by_staff || lead.assigned_to : lead.assigned_to,
      addressedToday,
      timeToCallMs: leadResponseTimeMs(lead.submitted_at, lead.first_call_at),
      timeToQuoteMs: leadResponseTimeMs(lead.submitted_at, firstQuoteAt),
    },
    openQuotes.length,
  );
}

function quoteRow(group: FollowUpLead[], opts: BuildOptions): CombinedRow {
  const quotes = [...group].sort((a, b) => quoteTime(b) - quoteTime(a));
  const openQuotes = quotes.filter(isQuoteOpen);
  const primary = openQuotes[0] ?? quotes[0];
  const oldest = quotes[quotes.length - 1];
  const stage = stageFromQuote(primary);
  const receivedAt = oldest.shopify_created_at ?? oldest.first_synced_at;
  const next = deriveNext(stage, "not_required", primary, openQuotes.length, receivedAt, opts);
  return finishRow(
    {
      id: `quote:${primary.id}`,
      kind: "quote",
      name: primary.customer_name?.trim() || primary.customer_email || primary.draft_name,
      email: primary.customer_email,
      phone: primary.customer_phone,
      source: "quote",
      storeId: opts.storeId,
      receivedAt,
      lead: null,
      quotes,
      primaryQuote: primary,
      stage,
      callState: "not_required",
      next,
      attempts: primary.followup_count,
      staff: primary.last_invoice_sender || primary.created_by_staff || null,
      addressedToday: quotes.some((quote) => opts.addressedQuoteIds.has(quote.id)),
      timeToCallMs: null,
      timeToQuoteMs: null,
    },
    openQuotes.length,
  );
}

/** Group quotes that matched no lead by contact, so a repeat customer is one row. */
function groupOrphans(orphans: FollowUpLead[]): FollowUpLead[][] {
  const groups = new Map<string, FollowUpLead[]>();
  for (const quote of orphans) {
    const key =
      normalizedEmail(quote.customer_email) ??
      normalizedPhone(quote.customer_phone) ??
      `draft:${quote.id}`;
    const list = groups.get(key);
    if (list) list.push(quote);
    else groups.set(key, [quote]);
  }
  return Array.from(groups.values());
}

export function buildCombinedRows(leads: Lead[], quotes: FollowUpLead[], opts: BuildOptions): CombinedRow[] {
  const { byLead, orphans } = assignQuotesToLeads(leads, quotes);
  const rows = leads.map((lead) => leadRow(lead, byLead.get(lead.id) ?? [], opts));
  for (const group of groupOrphans(orphans)) rows.push(quoteRow(group, opts));
  return rows;
}

const URGENCY_RANK: Record<NextUrgency, number> = { overdue: 0, now: 1, today: 2, later: 3, none: 4 };

/** Most urgent first, then newest. */
export function sortByUrgency(rows: CombinedRow[]): CombinedRow[] {
  return [...rows].sort((a, b) => {
    const rank = URGENCY_RANK[a.next.urgency] - URGENCY_RANK[b.next.urgency];
    if (rank !== 0) return rank;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

function emptySplit(): SourceSplit {
  return { website: 0, meta: 0, quote: 0 };
}

export function summarize(rows: CombinedRow[], opts: BuildOptions): CombinedSummary {
  const nowMs = opts.now.getTime();
  const thirtyDaysAgo = new Date(nowMs - 30 * DAY_MS).toISOString();
  const summary: CombinedSummary = {
    needCall: { total: 0, over24h: 0, split: emptySplit() },
    followupsDue: { total: 0, overdue: 0, split: emptySplit() },
    newLeads30d: { total: 0, split: emptySplit() },
    openQuotes: { count: 0, amount: 0, split: emptySplit() },
    conversion: { won: 0, lost: 0, rate: null },
    attempts: { average: null, quotes: 0 },
    medianCallMs: null,
    medianQuoteMs: null,
    spam: 0,
  };
  const callDurations: Array<number | null> = [];
  const quoteDurations: Array<number | null> = [];
  let attemptsTotal = 0;

  for (const row of rows) {
    if (row.lead?.isSpam) {
      summary.spam += 1;
      continue;
    }
    if (row.next.kind === "call" && row.next.urgency === "now") {
      summary.needCall.total += 1;
      summary.needCall.split[row.source] += 1;
      if (nowMs - new Date(row.receivedAt).getTime() >= DAY_MS) summary.needCall.over24h += 1;
    }
    if (row.next.kind === "followup" && (row.next.urgency === "today" || row.next.urgency === "overdue")) {
      summary.followupsDue.total += 1;
      summary.followupsDue.split[row.source] += 1;
      if (row.next.urgency === "overdue") summary.followupsDue.overdue += 1;
    }
    if (row.kind === "lead" && row.receivedAt >= thirtyDaysAgo) {
      summary.newLeads30d.total += 1;
      summary.newLeads30d.split[row.source] += 1;
      callDurations.push(row.timeToCallMs);
      quoteDurations.push(row.timeToQuoteMs);
    }
    for (const quote of row.quotes) {
      summary.attempts.quotes += 1;
      attemptsTotal += quote.followup_count;
      if (isQuoteOpen(quote)) {
        summary.openQuotes.count += 1;
        summary.openQuotes.amount += Number(quote.quote_amount) || 0;
        summary.openQuotes.split[row.source] += Number(quote.quote_amount) || 0;
      }
      if (quote.lead_status === "won") summary.conversion.won += 1;
      else if (quote.lead_status === "lost") summary.conversion.lost += 1;
    }
  }

  const closed = summary.conversion.won + summary.conversion.lost;
  summary.conversion.rate = closed > 0 ? summary.conversion.won / closed : null;
  summary.attempts.average = summary.attempts.quotes > 0 ? attemptsTotal / summary.attempts.quotes : null;
  summary.medianCallMs = medianLeadResponseTimeMs(callDurations);
  summary.medianQuoteMs = medianLeadResponseTimeMs(quoteDurations);
  return summary;
}

export function countTabs(rows: CombinedRow[]): Record<CombinedTab, number> {
  const counts: Record<CombinedTab, number> = {
    todo: 0, upcoming: 0, addressed: 0, awaiting: 0, open: 0, closed: 0, all: 0, dupes: 0,
  };
  for (const row of rows) for (const tab of row.tabs) counts[tab] += 1;
  return counts;
}

export interface CombinedPayload {
  store: LeadStoreId;
  generatedAt: string;
  rows: CombinedRow[];
  summary: CombinedSummary;
  counts: Record<CombinedTab, number>;
  // Shopify stores in this scope, for "View in Shopify" links.
  shops: { id: string; label: string; domain: string }[];
}
