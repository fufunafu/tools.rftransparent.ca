import { revalidateTag, unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import {
  extractContactFields,
  type Lead,
  type LeadSource,
} from "@/lib/customer-service/leads";
import type { LeadAttachment } from "@/lib/customer-service/lead-attachments";
import { consolidateDuplicateLeads } from "@/lib/lead-deduplication";

const PAGE_SIZE = 1000;
const REVALIDATE_SECONDS = 60;
const LEADS_CACHE_TAG = "customer-service:leads";

type LeadRow = { id: string; [key: string]: unknown };
type AttemptRow = { lead_id: string; staff: string; called_at: string };
type AttachmentRow = LeadAttachment;

async function fetchAllPages<T>(
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

export async function loadLeads(source?: LeadSource): Promise<Lead[]> {
  const supabase = getSupabase();
  const leads = await fetchAllPages<LeadRow>((from, to) => {
    let query = supabase
      .from("leads")
      .select("*")
      .order("submitted_at", { ascending: false })
      .range(from, to);
    if (source) query = query.eq("source", source);
    return query;
  });

  const attachmentsByLead = new Map<string, LeadAttachment[]>();
  let attachments: AttachmentRow[] = [];
  try {
    attachments = await fetchAllPages<AttachmentRow>((from, to) =>
      supabase
        .from("lead_attachments")
        .select("id, lead_id, field_name, filename, content_type, size_bytes, created_at")
        .order("created_at", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/lead_attachments|schema cache|relation/i.test(message)) throw error;
  }
  for (const attachment of attachments) {
    const current = attachmentsByLead.get(attachment.lead_id) ?? [];
    current.push(attachment);
    attachmentsByLead.set(attachment.lead_id, current);
  }

  const attemptAgg = new Map<string, {
    count: number;
    first_at: string;
    last_at: string;
    last_staff: string;
  }>();
  if (leads.length > 0) {
    const attempts = await fetchAllPages<AttemptRow>((from, to) =>
      supabase
        .from("lead_call_attempts")
        .select("lead_id, staff, called_at")
        .order("called_at", { ascending: false })
        .range(from, to),
    );
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
  }

  const enriched: Lead[] = leads.map((lead) => {
    const aggregate = attemptAgg.get(lead.id);
    const recovered = lead.raw_payload
      && typeof lead.raw_payload === "object"
      && !Array.isArray(lead.raw_payload)
      ? extractContactFields(lead.raw_payload as Record<string, unknown>)
      : { name: null, email: null, phone: null, message: null };
    const present = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
    return {
      ...lead,
      name: present(lead.name) ?? recovered.name,
      email: present(lead.email) ?? recovered.email,
      phone: present(lead.phone) ?? recovered.phone,
      message: present(lead.message) ?? recovered.message,
      attachments: attachmentsByLead.get(lead.id) ?? [],
      call_attempts_count: aggregate?.count ?? 0,
      first_call_at: aggregate?.first_at ?? null,
      last_call_at: aggregate?.last_at ?? null,
      last_called_by: aggregate?.last_staff ?? null,
    } as unknown as Lead;
  });

  return consolidateDuplicateLeads(enriched);
}

export const getCachedLeads = unstable_cache(
  () => loadLeads(),
  ["customer-service:leads:list"],
  { tags: [LEADS_CACHE_TAG], revalidate: REVALIDATE_SECONDS },
);

export function markLeadsCacheStale(): void {
  revalidateTag(LEADS_CACHE_TAG, "max");
}
