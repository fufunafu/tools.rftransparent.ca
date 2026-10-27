import { sanitizePhone } from "@/lib/call-metrics";
import { STORE_SCOPES } from "@/lib/store-scopes";
import { getSupabase } from "@/lib/supabase";
import { HISTORICAL_UNKNOWN_REASON } from "@/lib/customer-service/leads";

type LeadOutcome = "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable";

export interface LeadForQuoteSync {
  store_id?: string;
  quote_draft_id?: string | null;
  quote_amount?: number | string | null;
  quote_sent_at?: string | null;
  first_quote_at?: string | null;
  id: string;
  email: string | null;
  phone: string | null;
  submitted_at: string;
  outcome: LeadOutcome;
  quote_number: string | null;
  assigned_to: string | null;
  not_applicable_reason: string | null;
}

export interface DraftForLeadQuoteSync {
  store_id?: string;
  last_invoice_sent_at?: string | null;
  shopify_draft_id: string;
  draft_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  quote_amount: number | string;
  shopify_created_at: string | null;
  shopify_status: string;
  first_synced_at: string;
  last_invoice_sender: string | null;
  created_by_staff: string | null;
}

export interface LeadQuoteMatch {
  leadId: string;
  draftId: string;
  quoteNumber: string;
  quoteAmount: number;
  quoteSentAt: string | null;
  firstQuoteAt: string | null;
  outcome: "quoted" | "won";
  responsibleStaff: string | null;
  // A historical import that this quote proves was actually worked; the
  // sync re-opens it as a real quoted/won lead.
  reopenHistorical?: boolean;
}

export interface LeadStaffMatch {
  leadId: string;
  responsibleStaff: string;
}

export interface LeadQuoteSyncSummary {
  leadsScanned: number;
  draftsScanned: number;
  matchedLeads: number;
  linked: number;
  quoted: number;
  won: number;
  staffAssigned: number;
  errors: number;
  firstError: string | null;
}

interface IndexedLead extends LeadForQuoteSync {
  submittedTime: number;
}

const PAGE_SIZE = 1000;
const WRITE_CONCURRENCY = 25;

function normalizedEmail(raw: string | null): string | null {
  const email = raw?.replace(/\s+/g, "").toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

function normalizedPhone(raw: string | null): string | null {
  const phone = sanitizePhone(raw);
  return phone && phone.length >= 10 ? phone : null;
}

function isHistoricalLead(lead: LeadForQuoteSync): boolean {
  return lead.not_applicable_reason === HISTORICAL_UNKNOWN_REASON;
}

function responsibleStaff(draft: DraftForLeadQuoteSync): string | null {
  return draft.last_invoice_sender?.trim() || draft.created_by_staff?.trim() || null;
}

const sameStore = (lead: LeadForQuoteSync, draft: DraftForLeadQuoteSync) => !lead.store_id || !draft.store_id
    || Object.values(STORE_SCOPES).some((scope) => scope.phoneStoreIds.includes(lead.store_id!) && scope.shopifyStoreIds.includes(draft.store_id!));

export function matchDraftOrdersToLeads(
  leads: LeadForQuoteSync[], drafts: DraftForLeadQuoteSync[],
): LeadQuoteMatch[] {
  const byEmail = new Map<string, IndexedLead[]>();
  const byPhone = new Map<string, IndexedLead[]>();
  for (const lead of leads) {
    const submittedTime = Date.parse(lead.submitted_at);
    if (!Number.isFinite(submittedTime)) continue;
    const indexed = { ...lead, submittedTime };
    const email = normalizedEmail(lead.email), phone = normalizedPhone(lead.phone);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), indexed]);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), indexed]);
  }
  const validTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null;
  const sent = drafts.filter((draft) => ['INVOICE_SENT', 'COMPLETED'].includes(draft.shopify_status)).map((draft) => {
    const quoteSentAt = validTime(draft.last_invoice_sent_at);
    // Creation time can establish a historical association, but must never be
    // presented as proof of when a quote was actually sent.
    const observedAt = quoteSentAt ?? validTime(draft.shopify_created_at) ?? validTime(draft.first_synced_at);
    return { draft, quoteSentAt, draftTime: observedAt ? Date.parse(observedAt) : NaN };
  }).filter((entry) => Number.isFinite(entry.draftTime)).sort((a, b) => a.draftTime - b.draftTime || a.draft.shopify_draft_id.localeCompare(b.draft.shopify_draft_id));
  const byNumber = new Map<string, DraftForLeadQuoteSync[]>();
  for (const { draft } of sent) byNumber.set(draft.draft_name, [...(byNumber.get(draft.draft_name) ?? []), draft]);
  const matches = new Map<string, LeadQuoteMatch>();
  for (const { draft, quoteSentAt, draftTime } of sent) {
    const email = normalizedEmail(draft.customer_email), phone = normalizedPhone(draft.customer_phone);
    const choose = (candidates: IndexedLead[]) => {
      const eligible = candidates.filter((lead) => sameStore(lead, draft) && lead.submittedTime <= draftTime);
      const live = eligible.filter((lead) => !isHistoricalLead(lead));
      return (live.length ? live : eligible).sort((a, b) => b.submittedTime - a.submittedTime)[0];
    };
    const lead = choose(email ? byEmail.get(email) ?? [] : []) ?? choose((phone ? byPhone.get(phone) ?? [] : []).filter((candidate) => !email || !normalizedEmail(candidate.email)));
    if (!lead || lead.outcome === 'lost' || (lead.outcome === 'not_applicable' && !isHistoricalLead(lead))) continue;
    // Preserve manually entered references that cannot be verified in Shopify.
    if (lead.quote_number && !lead.quote_draft_id && !(byNumber.get(lead.quote_number) ?? []).some((candidate) => sameStore(lead, candidate) &&
      ((normalizedEmail(lead.email) && normalizedEmail(candidate.customer_email) === normalizedEmail(lead.email)) ||
       ((!normalizedEmail(lead.email) || !normalizedEmail(candidate.customer_email)) && normalizedPhone(lead.phone) && normalizedPhone(candidate.customer_phone) === normalizedPhone(lead.phone))))) continue;
    const previous = matches.get(lead.id);
    const firstTimes = [lead.first_quote_at, previous?.firstQuoteAt, quoteSentAt].filter((value): value is string => Boolean(value));
    const firstQuoteAt = firstTimes.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    matches.set(lead.id, {
      leadId: lead.id, draftId: draft.shopify_draft_id, quoteNumber: draft.draft_name,
      quoteAmount: Number(draft.quote_amount) || 0, quoteSentAt, firstQuoteAt,
      outcome: lead.outcome === 'won' || previous?.outcome === 'won' || draft.shopify_status === 'COMPLETED' ? 'won' : 'quoted',
      responsibleStaff: responsibleStaff(draft),
      ...(isHistoricalLead(lead) ? { reopenHistorical: true } : {}),
    });
  }
  return [...matches.values()];
}

/** Match already-linked quotes to staff without changing the quote linkage. */
export function matchStaffToLinkedLeads(
  leads: LeadForQuoteSync[],
  drafts: DraftForLeadQuoteSync[],
): LeadStaffMatch[] {
  const draftsByNumber = new Map<string, DraftForLeadQuoteSync[]>();
  for (const draft of drafts) {
    if (!responsibleStaff(draft)) continue;
    draftsByNumber.set(draft.draft_name, [
      ...(draftsByNumber.get(draft.draft_name) ?? []),
      draft,
    ]);
  }

  const matches: LeadStaffMatch[] = [];
  for (const lead of leads) {
    if (isHistoricalLead(lead) || !lead.quote_number || lead.assigned_to) continue;
    const candidates = (draftsByNumber.get(lead.quote_number) ?? []).filter((draft) => sameStore(lead, draft));
    const email = normalizedEmail(lead.email);
    const phone = normalizedPhone(lead.phone);
    const draft =
      candidates.find((candidate) => email && normalizedEmail(candidate.customer_email) === email) ??
      candidates.find((candidate) => phone && (!email || !normalizedEmail(candidate.customer_email)) && normalizedPhone(candidate.customer_phone) === phone);
    const staff = draft ? responsibleStaff(draft) : null;
    if (staff) matches.push({ leadId: lead.id, responsibleStaff: staff });
  }
  return matches;
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

// The Follow-up page's live refresh runs an incremental draft sync every 30s
// per open tab. Re-matching every lead against every sent quote on each tick
// was the database's heaviest query, so the live path re-matches only when the
// sync touched drafts, at most once per LIVE_REMATCH_INTERVAL_MS per store on
// this instance. A changed draft keeps showing up for the sync's 10-minute
// lookback, so a throttled tick is picked up by a later one, and the hourly
// sync-lead-quotes cron still runs the full match.
const LIVE_REMATCH_INTERVAL_MS = 2 * 60 * 1000;
const lastLiveRematch = new Map<string, number>();

export function shouldRematchAfterLiveSync(
  storeId: string,
  sync: { new_leads: number; updated_leads: number; auto_won: number },
  now = Date.now(),
): boolean {
  if (sync.new_leads + sync.updated_leads + sync.auto_won === 0) return false;
  const last = lastLiveRematch.get(storeId);
  if (last !== undefined && now - last < LIVE_REMATCH_INTERVAL_MS) return false;
  lastLiveRematch.set(storeId, now);
  return true;
}

export function resetLiveRematchThrottle(): void {
  lastLiveRematch.clear();
}

export async function syncLeadQuotesFromFollowups(
  storeIds?: string[],
): Promise<LeadQuoteSyncSummary> {
  const supabase = getSupabase();
  const leads = await fetchAllRows<LeadForQuoteSync>((from, to) =>
    supabase
      .from("leads")
      .select("id,store_id,email,phone,submitted_at,outcome,quote_number,quote_amount,quote_sent_at,first_quote_at,quote_draft_id,assigned_to,not_applicable_reason")
      .order("submitted_at", { ascending: true })
      .range(from, to),
  );

  const drafts = await fetchAllRows<DraftForLeadQuoteSync>((from, to) => {
    let query = supabase
      .from("followup_leads")
      .select("shopify_draft_id,draft_name,customer_email,customer_phone,quote_amount,shopify_created_at,last_invoice_sent_at,shopify_status,first_synced_at,last_invoice_sender,created_by_staff,store_id")
      .in("shopify_status", ["INVOICE_SENT", "COMPLETED"])
      .order("shopify_created_at", { ascending: true })
      .range(from, to);
    if (storeIds?.length) query = query.in("store_id", storeIds);
    return query;
  });

  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const allMatches = matchDraftOrdersToLeads(leads, drafts);
  const matches = allMatches.filter((match) => {
    const lead = leadById.get(match.leadId)!;
    return lead.quote_number !== match.quoteNumber || lead.quote_draft_id !== match.draftId
      || Number(lead.quote_amount) !== match.quoteAmount || lead.quote_sent_at !== match.quoteSentAt
      || lead.first_quote_at !== match.firstQuoteAt || lead.outcome !== match.outcome;
  });
  const staffMatches = matchStaffToLinkedLeads(leads, drafts);
  const linkedLeadIds = new Set<string>();
  const summary: LeadQuoteSyncSummary = {
    leadsScanned: leads.length,
    draftsScanned: drafts.length,
    matchedLeads: matches.length,
    linked: 0,
    quoted: 0,
    won: 0,
    staffAssigned: 0,
    errors: 0,
    firstError: null,
  };

  for (let offset = 0; offset < matches.length; offset += WRITE_CONCURRENCY) {
    const batch = matches.slice(offset, offset + WRITE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (match) => {
      let query = supabase
        .from("leads")
        .update({
          quote_number: match.quoteNumber,
          quote_amount: match.quoteAmount,
          quote_sent_at: match.quoteSentAt,
          first_quote_at: match.firstQuoteAt,
          quote_draft_id: match.draftId,
          outcome: match.outcome,
          ...(match.reopenHistorical ? { not_applicable_reason: null } : {}),
        })
        .eq("id", match.leadId);
      const prior = leadById.get(match.leadId)!;
      query = query.eq("outcome", prior.outcome);
      query = prior.quote_number == null ? query.is("quote_number", null) : query.eq("quote_number", prior.quote_number);
      query = match.reopenHistorical
        ? query.eq("not_applicable_reason", HISTORICAL_UNKNOWN_REASON)
        : query.not("outcome", "in", "(lost,not_applicable)");
      const { data, error } = await query.select("id");
      return { match, updated: data?.length ?? 0, error };
    }));

    for (const result of results) {
      if (result.error) {
        summary.errors++;
        const message = `[lead-quote-sync] ${result.match.leadId}: ${result.error.message}`;
        console.error(message);
        if (!summary.firstError) summary.firstError = message;
        continue;
      }
      if (result.updated === 0) continue;
      summary.linked++;
      linkedLeadIds.add(result.match.leadId);
      if (result.match.outcome === "won") summary.won++;
      else summary.quoted++;
    }
  }

  const staffByLeadId = new Map<string, string>();
  for (const match of allMatches) {
    const lead = leadById.get(match.leadId);
    if (linkedLeadIds.has(match.leadId) && match.responsibleStaff && !lead?.assigned_to) {
      staffByLeadId.set(match.leadId, match.responsibleStaff);
    }
  }
  for (const match of staffMatches) {
    staffByLeadId.set(match.leadId, match.responsibleStaff);
  }

  const staffUpdates = [...staffByLeadId].map(([leadId, staff]) => ({ leadId, staff }));
  for (let offset = 0; offset < staffUpdates.length; offset += WRITE_CONCURRENCY) {
    const batch = staffUpdates.slice(offset, offset + WRITE_CONCURRENCY);
    const results = await Promise.all(batch.map(async ({ leadId, staff }) => {
      const { data, error } = await supabase
        .from("leads")
        .update({ assigned_to: staff })
        .eq("id", leadId)
        .is("assigned_to", null)
        .select("id");
      return { leadId, updated: data?.length ?? 0, error };
    }));

    for (const result of results) {
      if (result.error) {
        summary.errors++;
        const message = `[lead-quote-sync] staff ${result.leadId}: ${result.error.message}`;
        console.error(message);
        if (!summary.firstError) summary.firstError = message;
      } else if (result.updated > 0) {
        summary.staffAssigned++;
      }
    }
  }

  return summary;
}
