import { sanitizePhone } from "@/lib/call-metrics";
import { getSupabase } from "@/lib/supabase";
import { HISTORICAL_UNKNOWN_REASON } from "@/lib/customer-service/leads";

type LeadOutcome = "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable";

export interface LeadForQuoteSync {
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
  quoteSentAt: string;
  outcome: "quoted" | "won";
  responsibleStaff: string | null;
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

function latestLeadBeforeDraft(
  candidates: IndexedLead[] | undefined,
  draftTime: number,
): IndexedLead | null {
  if (!candidates) return null;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index];
    if (candidate.submittedTime <= draftTime) return candidate;
  }
  return null;
}

/**
 * Match each sent draft to the most recent lead submitted before it. Protected
 * leads are skipped without falling back to an older record for that contact.
 * Email is authoritative when present; phone is the fallback.
 */
export function matchDraftOrdersToLeads(
  leads: LeadForQuoteSync[],
  drafts: DraftForLeadQuoteSync[],
): LeadQuoteMatch[] {
  const leadsByEmail = new Map<string, IndexedLead[]>();
  const leadsByPhone = new Map<string, IndexedLead[]>();

  for (const lead of leads) {
    if (isHistoricalLead(lead)) continue;
    const submittedTime = new Date(lead.submitted_at).getTime();
    if (Number.isNaN(submittedTime)) continue;

    const indexed = { ...lead, submittedTime };
    const email = normalizedEmail(lead.email);
    const phone = normalizedPhone(lead.phone);
    if (email) leadsByEmail.set(email, [...(leadsByEmail.get(email) ?? []), indexed]);
    if (phone) leadsByPhone.set(phone, [...(leadsByPhone.get(phone) ?? []), indexed]);
  }

  for (const candidates of [...leadsByEmail.values(), ...leadsByPhone.values()]) {
    candidates.sort((a, b) => a.submittedTime - b.submittedTime);
  }

  const eligibleDrafts = drafts
    .filter((draft) => draft.shopify_status === "INVOICE_SENT" || draft.shopify_status === "COMPLETED")
    .map((draft) => {
      const quoteSentAt = draft.shopify_created_at ?? draft.first_synced_at;
      return { draft, quoteSentAt, draftTime: new Date(quoteSentAt).getTime() };
    })
    .filter((entry) => !Number.isNaN(entry.draftTime))
    .sort((a, b) => a.draftTime - b.draftTime);

  const matchedLeadIds = new Set<string>();
  const matchedDraftIds = new Set<string>();
  const matches: LeadQuoteMatch[] = [];

  for (const { draft, quoteSentAt, draftTime } of eligibleDrafts) {
    if (matchedDraftIds.has(draft.shopify_draft_id)) continue;

    const email = normalizedEmail(draft.customer_email);
    const phone = normalizedPhone(draft.customer_phone);
    const lead =
      latestLeadBeforeDraft(email ? leadsByEmail.get(email) : undefined, draftTime) ??
      latestLeadBeforeDraft(phone ? leadsByPhone.get(phone) : undefined, draftTime);
    if (!lead) continue;
    if (
      matchedLeadIds.has(lead.id) ||
      lead.quote_number ||
      lead.outcome === "won" ||
      lead.outcome === "lost" ||
      lead.outcome === "not_applicable"
    ) continue;

    matchedLeadIds.add(lead.id);
    matchedDraftIds.add(draft.shopify_draft_id);
    matches.push({
      leadId: lead.id,
      draftId: draft.shopify_draft_id,
      quoteNumber: draft.draft_name,
      quoteAmount: Number(draft.quote_amount) || 0,
      quoteSentAt,
      outcome: draft.shopify_status === "COMPLETED" ? "won" : "quoted",
      responsibleStaff: responsibleStaff(draft),
    });
  }

  return matches;
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
    const candidates = draftsByNumber.get(lead.quote_number) ?? [];
    const email = normalizedEmail(lead.email);
    const phone = normalizedPhone(lead.phone);
    const draft =
      candidates.find((candidate) => email && normalizedEmail(candidate.customer_email) === email) ??
      candidates.find((candidate) => phone && normalizedPhone(candidate.customer_phone) === phone);
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

export async function syncLeadQuotesFromFollowups(
  storeIds?: string[],
): Promise<LeadQuoteSyncSummary> {
  const supabase = getSupabase();
  const leads = await fetchAllRows<LeadForQuoteSync>((from, to) =>
    supabase
      .from("leads")
      .select("id,email,phone,submitted_at,outcome,quote_number,assigned_to,not_applicable_reason")
      .order("submitted_at", { ascending: true })
      .range(from, to),
  );

  const drafts = await fetchAllRows<DraftForLeadQuoteSync>((from, to) => {
    let query = supabase
      .from("followup_leads")
      .select("shopify_draft_id,draft_name,customer_email,customer_phone,quote_amount,shopify_created_at,shopify_status,first_synced_at,last_invoice_sender,created_by_staff")
      .in("shopify_status", ["INVOICE_SENT", "COMPLETED"])
      .order("shopify_created_at", { ascending: true })
      .range(from, to);
    if (storeIds?.length) query = query.in("store_id", storeIds);
    return query;
  });

  const matches = matchDraftOrdersToLeads(leads, drafts);
  const staffMatches = matchStaffToLinkedLeads(leads, drafts);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
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
      const { data, error } = await supabase
        .from("leads")
        .update({
          quote_number: match.quoteNumber,
          quote_amount: match.quoteAmount,
          quote_sent_at: match.quoteSentAt,
          outcome: match.outcome,
        })
        .eq("id", match.leadId)
        .is("quote_number", null)
        .not("outcome", "in", "(won,lost,not_applicable)")
        .select("id");
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
  for (const match of matches) {
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
