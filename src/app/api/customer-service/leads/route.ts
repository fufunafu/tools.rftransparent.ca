// Auth-gated API for the Leads dashboard: list leads, list call attempts for
// a lead, log a call, update a lead's outcome / quote / notes.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  type CallStatus,
  type LeadSource,
  type Outcome,
} from "@/lib/customer-service/leads";
import { loadLeads, markLeadsCacheStale } from "@/lib/customer-service/lead-queries";
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

  const sourceParam = req.nextUrl.searchParams.get("source");
  const source: LeadSource | undefined = sourceParam === "website" || sourceParam === "meta"
    ? sourceParam
    : undefined;
  try {
    return NextResponse.json({ leads: await loadLeads(source) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load leads" },
      { status: 500 },
    );
  }
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
      markLeadsCacheStale();
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

    markLeadsCacheStale();
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
  markLeadsCacheStale();
  return NextResponse.json({ ok: true, updated: targetIds.length });
}
