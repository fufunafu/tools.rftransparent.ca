// Auth-gated API for the Leads dashboard: list leads, list synchronized call
// attempts for a lead, and update a lead's outcome / quote / notes.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  type CallStatus,
  type LeadSource,
  type Outcome,
} from "@/lib/customer-service/leads";
import {
  loadLeadGroupIds,
  loadLeadResponsePerformance,
  loadLeads,
  markLeadsCacheStale,
} from "@/lib/customer-service/lead-queries";
import { isCallablePhone } from "@/lib/call-metrics";
import { isLeadStoreId } from "@/lib/customer-service/lead-store";
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
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "list";

  if (view === "meta_status") {
    const [status, canSync] = await Promise.all([
      getMetaConnectionStatus(),
      isAdminUser(),
    ]);
    return NextResponse.json({ ...status, can_sync: canSync });
  }

  if (view === "call_attempts") {
    const supabase = getSupabase();
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
    const since = req.nextUrl.searchParams.get("since");
    if (since && Number.isNaN(new Date(since).getTime())) {
      return NextResponse.json({ error: "Invalid call activity boundary" }, { status: 400 });
    }
    let query = supabase
      .from("lead_call_attempts")
      .select("*")
      .in("lead_id", leadIds);
    if (since) query = query.gte("called_at", since);
    const { data, error } = await query.order("called_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ attempts: data ?? [] });
  }

  if (view === "details") {
    const supabase = getSupabase();
    const suppliedIds = (req.nextUrl.searchParams.get("lead_ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 50);
    const leadId = req.nextUrl.searchParams.get("lead_id")?.trim();
    if (suppliedIds.length === 0 && !leadId) {
      return NextResponse.json({ error: "lead_id required" }, { status: 400 });
    }
    const leadIds = suppliedIds.length > 0
      ? suppliedIds
      : await loadLeadGroupIds(leadId!);

    const [leadResult, attachmentResult] = await Promise.all([
      supabase
        .from("leads")
        .select("id, source, source_detail, form_id, page_url, name, email, phone, message, installation_requested, raw_payload, submitted_at")
        .in("id", leadIds),
      supabase
        .from("lead_attachments")
        .select("id, lead_id, field_name, filename, content_type, size_bytes, created_at")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: true }),
    ]);
    if (leadResult.error) {
      return NextResponse.json({ error: leadResult.error.message }, { status: 500 });
    }
    const attachmentsMissing = attachmentResult.error
      ? /lead_attachments|schema cache|relation/i.test(attachmentResult.error.message)
      : false;
    if (attachmentResult.error && !attachmentsMissing) {
      return NextResponse.json({ error: attachmentResult.error.message }, { status: 500 });
    }

    const attachmentsByLead = new Map<string, unknown[]>();
    for (const attachment of attachmentResult.data ?? []) {
      const current = attachmentsByLead.get(attachment.lead_id) ?? [];
      current.push(attachment);
      attachmentsByLead.set(attachment.lead_id, current);
    }
    return NextResponse.json({
      lead_ids: leadIds,
      details: (leadResult.data ?? []).map((lead) => ({
        ...lead,
        raw_payload: lead.raw_payload ?? {},
        attachments: attachmentsByLead.get(lead.id) ?? [],
      })),
    });
  }

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  if (
    (fromParam && !isDateKey(fromParam))
    || (toParam && !isDateKey(toParam))
    || (fromParam && toParam && fromParam > toParam)
  ) {
    return NextResponse.json({ error: "Invalid lead date range" }, { status: 400 });
  }
  const storeParam = req.nextUrl.searchParams.get("store");
  if (storeParam && !isLeadStoreId(storeParam)) {
    return NextResponse.json({ error: "Invalid store" }, { status: 400 });
  }
  const store = storeParam && isLeadStoreId(storeParam) ? storeParam : undefined;
  if (view === "response_performance") {
    try {
      const performance = await loadLeadResponsePerformance({
        store,
        from: fromParam,
        to: toParam,
      });
      return NextResponse.json({
        leads: performance.leads,
        tracking_started_at: performance.trackingStartedAt,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not load response performance" },
        { status: 500 },
      );
    }
  }

  const sourceParam = req.nextUrl.searchParams.get("source");
  const source: LeadSource | undefined = sourceParam === "website" || sourceParam === "meta"
    ? sourceParam
    : undefined;
  try {
    return NextResponse.json({
      leads: await loadLeads({
        store,
        source,
        from: fromParam,
        to: toParam,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load leads" },
      { status: 500 },
    );
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get("action");
  if (action === "sync_meta") {
    if (!(await isAdminUser())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const summary = await syncRecentMetaLeads();
      markLeadsCacheStale();
      return NextResponse.json({ ok: true, summary });
    } catch (error) {
      return NextResponse.json({ error: metaErrorMessage(error) }, { status: 502 });
    }
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
  if (rest.quote_amount === null) {
    update.quote_amount = null;
  } else if (typeof rest.quote_amount === "number") {
    if (!Number.isFinite(rest.quote_amount) || rest.quote_amount < 0) {
      return NextResponse.json({ error: "quote_amount must be a non-negative number" }, { status: 400 });
    }
    update.quote_amount = rest.quote_amount;
  }
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
  // "Send to BC" / "Send to RF": move the lead to the other store's queue.
  if (rest.store_id !== undefined) {
    if (!isLeadStoreId(rest.store_id)) {
      return NextResponse.json({ error: "Invalid store" }, { status: 400 });
    }
    update.store_id = rest.store_id;
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
  markLeadsCacheStale();
  return NextResponse.json({ ok: true, updated: targetIds.length });
}
