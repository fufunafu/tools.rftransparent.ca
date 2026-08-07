import { revalidateTag, unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import {
  HISTORICAL_UNKNOWN_REASON,
  type Lead,
  type LeadSource,
} from "@/lib/customer-service/leads";
import { consolidateDuplicateLeads } from "@/lib/lead-deduplication";

const PAGE_SIZE = 1000;
const REVALIDATE_SECONDS = 60;
const LEADS_CACHE_TAG = "customer-service:leads";
const LEAD_LIST_COLUMNS =
  "id,source,name,email,phone,installation_requested,submitted_at,call_status,outcome,quote_number,quote_amount,quote_sent_at,lost_reason,not_applicable_reason,notes,assigned_to";
const LEAD_GROUP_COLUMNS = "id,email,phone,submitted_at,not_applicable_reason";

type LeadRow = { id: string; [key: string]: unknown };
type AttemptRow = { lead_id: string; staff: string; called_at: string };

async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    // Supabase can cap a requested page below PAGE_SIZE. Advance by the
    // number actually returned and continue until the first empty page so a
    // project-level response limit cannot silently truncate lead analytics.
    from += data.length;
  }
}

export async function loadLeads(source?: LeadSource): Promise<Lead[]> {
  const supabase = getSupabase();
  const leadsPromise = fetchAllPages<LeadRow>((from, to) => {
    let query = supabase
      .from("leads")
      .select(LEAD_LIST_COLUMNS)
      .order("submitted_at", { ascending: false })
      .range(from, to);
    if (source) query = query.eq("source", source);
    return query;
  });
  const attemptsPromise = fetchAllPages<AttemptRow>((from, to) =>
    supabase
      .from("lead_call_attempts")
      .select("lead_id, staff, called_at")
      .order("called_at", { ascending: false })
      .range(from, to),
  );

  // These tables are independent. Keeping their pagination concurrent makes
  // a cold cache cost one scan duration instead of the sum of both.
  const [leads, attempts] = await Promise.all([
    leadsPromise,
    attemptsPromise,
  ]);

  const attemptAgg = new Map<string, {
    count: number;
    first_at: string;
    last_at: string;
    last_staff: string;
  }>();
  for (const attempt of attempts) {
    const previous = attemptAgg.get(attempt.lead_id);
    if (!previous) {
      attemptAgg.set(attempt.lead_id, {
        count: 1,
        first_at: attempt.called_at,
        last_at: attempt.called_at,
        last_staff: attempt.staff,
      });
    } else {
      previous.count += 1;
      previous.first_at = attempt.called_at;
    }
  }

  const enriched: Lead[] = leads.map((lead) => {
    const aggregate = attemptAgg.get(lead.id);
    return {
      ...lead,
      raw_payload: {},
      call_attempts_count: aggregate?.count ?? 0,
      first_call_at: aggregate?.first_at ?? null,
      last_call_at: aggregate?.last_at ?? null,
      last_called_by: aggregate?.last_staff ?? null,
    } as unknown as Lead;
  });

  const consolidated = consolidateDuplicateLeads(enriched).map((lead) => {
    const summary: Partial<typeof lead> = { ...lead };
    delete summary.submissions;
    delete summary.attachments;
    delete summary.form_id;
    delete summary.page_url;
    delete summary.message;
    if (summary.not_applicable_reason === HISTORICAL_UNKNOWN_REASON) {
      summary.not_applicable_reason = null;
      summary.raw_payload = { historical_import: true };
    } else {
      delete summary.raw_payload;
    }
    delete summary.source_detail;
    delete summary.call_attempts_count;
    delete summary.duplicate_ids;
    if ((summary.duplicate_count ?? 1) <= 1) {
      delete summary.duplicate_count;
    }
    return summary as Lead;
  });
  if (process.env.NODE_ENV === "development") {
    const fieldBytes = new Map<string, number>();
    for (const lead of consolidated) {
      for (const [key, value] of Object.entries(lead)) {
        fieldBytes.set(key, (fieldBytes.get(key) ?? 0) + Buffer.byteLength(JSON.stringify(value)));
      }
    }
    const largest = [...fieldBytes.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([key, bytes]) => `${key}=${bytes}`)
      .join(", ");
    console.info(
      `[leads] lightweight list: ${Buffer.byteLength(JSON.stringify(consolidated))} bytes; ${largest}`,
    );
  }
  return consolidated;
}

export async function loadLeadGroupIds(leadId: string): Promise<string[]> {
  const supabase = getSupabase();
  const rows = await fetchAllPages<LeadRow>((from, to) => (
    supabase
      .from("leads")
      .select(LEAD_GROUP_COLUMNS)
      .order("submitted_at", { ascending: false })
      .range(from, to)
  ));
  const leads = rows.map((row) => ({
    id: row.id,
    source: "website",
    source_detail: null,
    form_id: null,
    page_url: null,
    name: null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    message: null,
    installation_requested: null,
    raw_payload: {},
    submitted_at: String(row.submitted_at ?? ""),
    call_status: "not_called",
    outcome: row.not_applicable_reason === HISTORICAL_UNKNOWN_REASON
      ? "not_applicable"
      : "new",
    quote_number: null,
    quote_amount: null,
    quote_sent_at: null,
    lost_reason: null,
    not_applicable_reason: typeof row.not_applicable_reason === "string"
      ? row.not_applicable_reason
      : null,
    notes: null,
    assigned_to: null,
    created_at: "",
    updated_at: "",
  } satisfies Lead));
  const group = consolidateDuplicateLeads(leads).find((lead) => (
    lead.id === leadId || lead.duplicate_ids.includes(leadId)
  ));
  return group?.duplicate_ids ?? [leadId];
}

export const getCachedLeads = unstable_cache(
  () => loadLeads(),
  ["customer-service:leads:list"],
  { tags: [LEADS_CACHE_TAG], revalidate: REVALIDATE_SECONDS },
);

export function markLeadsCacheStale(): void {
  revalidateTag(LEADS_CACHE_TAG, "max");
}
