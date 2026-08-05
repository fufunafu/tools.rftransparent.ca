// Auth-gated API for the Leads dashboard: list leads, list call attempts for
// a lead, log a call, update a lead's outcome / quote / notes.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  extractContactFields,
  type Lead,
  type CallStatus,
  type Outcome,
} from "@/lib/customer-service/leads";
import type { LeadAttachment } from "@/lib/customer-service/lead-attachments";
import { consolidateDuplicateLeads } from "@/lib/lead-deduplication";
import { isCallablePhone } from "@/lib/call-metrics";
import {
  getMetaConnectionStatus,
  metaErrorMessage,
  syncRecentMetaLeads,
} from "@/lib/customer-service/meta-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_CALL_STATUSES: CallStatus[] = ["not_called", "no_answer", "called"];
const ALLOWED_OUTCOMES: Outcome[] = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
  "not_applicable",
];

// PostgREST caps every response at the project's max-rows — 1000 here — and
// does it silently: a plain select just returns fewer rows than exist. The
// Leads page showed "1000 total" while the table held 1066, and .range()
// can't be used to ask for more than the cap in one request. So page through
// it. Anything reading a whole table must go through this.
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    // A short page means we've reached the end.
    if (!data || data.length < PAGE_SIZE) return { rows, error: null };
  }
}

type LeadRow = { id: string; [key: string]: unknown };
type AttemptRow = { lead_id: string; staff: string; called_at: string };
type AttachmentRow = LeadAttachment;

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "list";
  const supabase = getSupabase();

  if (view === "meta_status") {
    const [status, canSync] = await Promise.all([
      getMetaConnectionStatus(),
      isAdminUser(),
    ]);
    return NextResponse.json({ ...status, can_sync: canSync });
  }

  if (view === "call_attempts") {
    const leadIds = (req.nextUrl.searchParams.get("lead_ids")
      ?? req.nextUrl.searchParams.get("lead_id")
      ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (leadIds.length === 0) {
      return NextResponse.json({ error: "lead_id or lead_ids required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("lead_call_attempts")
      .select("*")
      .in("lead_id", leadIds)
      .order("called_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ attempts: data ?? [] });
  }

  // Default: list of leads, newest first, optionally filtered by source.
  const source = req.nextUrl.searchParams.get("source"); // null | 'website' | 'meta'

  const { rows: leads, error } = await fetchAllPages<LeadRow>((from, to) => {
    let query = supabase
      .from("leads")
      .select("*")
      .order("submitted_at", { ascending: false })
      .range(from, to);
    if (source === "website" || source === "meta") query = query.eq("source", source);
    return query;
  });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const attachmentsByLead = new Map<string, LeadAttachment[]>();
  const { rows: attachments, error: attachmentsError } = await fetchAllPages<AttachmentRow>((from, to) =>
    supabase
      .from("lead_attachments")
      .select("id, lead_id, field_name, filename, content_type, size_bytes, created_at")
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const attachmentsTableMissing = attachmentsError
    ? /lead_attachments|schema cache|relation/i.test(attachmentsError)
    : false;
  if (attachmentsError && !attachmentsTableMissing) {
    return NextResponse.json({ error: attachmentsError }, { status: 500 });
  }
  for (const attachment of attachments) {
    const current = attachmentsByLead.get(attachment.lead_id) ?? [];
    current.push(attachment);
    attachmentsByLead.set(attachment.lead_id, current);
  }

  // Fetch call attempt aggregates so the table can show "last called by X".
  // Paged for the same reason — one busy week of calls would otherwise push
  // this past the cap and quietly drop the aggregate for some leads.
  const attemptAgg: Map<string, {
    count: number;
    first_at: string;
    last_at: string;
    last_staff: string;
  }> = new Map();
  if (leads.length > 0) {
    // Read the linked attempt table directly. Sending every lead ID through
    // one .in() filter creates a URL that PostgREST rejects once the queue is
    // large, which previously made every timing value disappear.
    const { rows: attempts, error: attemptsError } = await fetchAllPages<AttemptRow>((from, to) =>
      supabase
        .from("lead_call_attempts")
        .select("lead_id, staff, called_at")
        .order("called_at", { ascending: false })
        .range(from, to),
    );
    if (attemptsError) {
      return NextResponse.json({ error: attemptsError }, { status: 500 });
    }
    for (const a of attempts) {
      const prev = attemptAgg.get(a.lead_id);
      if (!prev) {
        attemptAgg.set(a.lead_id, {
          count: 1,
          first_at: a.called_at,
          last_at: a.called_at,
          last_staff: a.staff,
        });
      } else {
        prev.count += 1;
        // Rows are newest-first, so each later row is an older attempt.
        prev.first_at = a.called_at;
      }
    }
  }

  const enriched: Lead[] = leads.map((l) => {
    const agg = attemptAgg.get(l.id);
    const recovered = l.raw_payload && typeof l.raw_payload === "object" && !Array.isArray(l.raw_payload)
      ? extractContactFields(l.raw_payload as Record<string, unknown>)
      : { name: null, email: null, phone: null, message: null };
    const present = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
    return {
      ...l,
      name: present(l.name) ?? recovered.name,
      email: present(l.email) ?? recovered.email,
      phone: present(l.phone) ?? recovered.phone,
      message: present(l.message) ?? recovered.message,
      attachments: attachmentsByLead.get(l.id) ?? [],
      call_attempts_count: agg?.count ?? 0,
      first_call_at: agg?.first_at ?? null,
      last_call_at: agg?.last_at ?? null,
      last_called_by: agg?.last_staff ?? null,
    } as unknown as Lead;
  });

  return NextResponse.json({ leads: consolidateDuplicateLeads(enriched) });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action");
  const supabase = getSupabase();

  if (action === "sync_meta") {
    if (!(await isAdminUser())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const summary = await syncRecentMetaLeads();
      return NextResponse.json({ ok: true, summary });
    } catch (error) {
      return NextResponse.json({ error: metaErrorMessage(error) }, { status: 502 });
    }
  }

  if (action === "log_call") {
    const body = await req.json().catch(() => ({}));
    const { lead_id, result, notes } = body as { lead_id?: string; result?: string; notes?: string };
    if (!lead_id || !result) {
      return NextResponse.json({ error: "lead_id and result are required" }, { status: 400 });
    }
    const staff = user.email ?? "Unknown";

    // Insert the attempt
    const { error: attemptErr } = await supabase.from("lead_call_attempts").insert({
      lead_id,
      staff,
      result,
      notes: notes ?? null,
    });
    if (attemptErr) return NextResponse.json({ error: attemptErr.message }, { status: 500 });

    // Bump the lead's call_status. "no_answer" / "no answer" stays no_answer;
    // anything else means we actually spoke to them.
    const isNoAnswer = /no.?answer|voicemail|bad.?number|wrong.?number/i.test(result);
    const newStatus: CallStatus = isNoAnswer ? "no_answer" : "called";
    // Only bump outcome from 'new' → 'contacted'; never downgrade.
    const { data: cur } = await supabase
      .from("leads")
      .select("outcome")
      .eq("id", lead_id)
      .single();
    const update: Record<string, unknown> = { call_status: newStatus };
    if (cur?.outcome === "new") update.outcome = "contacted";

    const { error: updErr } = await supabase.from("leads").update(update).eq("id", lead_id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { id, ids, ...rest } = body as {
    id?: unknown;
    ids?: unknown;
  } & Record<string, unknown>;
  const targetIds = Array.from(new Set(
    typeof id === "string"
      ? [id]
      : Array.isArray(ids)
        ? ids.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [],
  ));
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "id or ids required" }, { status: 400 });
  }
  if (targetIds.length > 2000) {
    return NextResponse.json({ error: "Bulk updates are limited to 2000 leads" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof rest.outcome === "string" && ALLOWED_OUTCOMES.includes(rest.outcome as Outcome)) {
    update.outcome = rest.outcome;
  }
  if (typeof rest.call_status === "string" && ALLOWED_CALL_STATUSES.includes(rest.call_status as CallStatus)) {
    update.call_status = rest.call_status;
  }
  if (rest.quote_number === null || typeof rest.quote_number === "string") update.quote_number = rest.quote_number;
  if (rest.quote_amount === null || typeof rest.quote_amount === "number") update.quote_amount = rest.quote_amount;
  if (rest.quote_sent_at === null || typeof rest.quote_sent_at === "string") update.quote_sent_at = rest.quote_sent_at;
  if (rest.phone === null) {
    update.phone = null;
  } else if (typeof rest.phone === "string") {
    const phone = rest.phone.trim();
    if (!isCallablePhone(phone)) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }
    update.phone = phone;
  }
  if (rest.lost_reason === null || typeof rest.lost_reason === "string") update.lost_reason = rest.lost_reason;
  if (rest.not_applicable_reason === null || typeof rest.not_applicable_reason === "string") {
    update.not_applicable_reason = rest.not_applicable_reason;
  }
  if (rest.notes === null || typeof rest.notes === "string") update.notes = rest.notes;
  if (rest.assigned_to === null || typeof rest.assigned_to === "string") update.assigned_to = rest.assigned_to;
  if (rest.installation_requested === null || typeof rest.installation_requested === "boolean") {
    update.installation_requested = rest.installation_requested;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  const supabase = getSupabase();
  for (let offset = 0; offset < targetIds.length; offset += 200) {
    const chunk = targetIds.slice(offset, offset + 200);
    const { error } = await supabase.from("leads").update(update).in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: targetIds.length });
}
