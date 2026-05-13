// Auth-gated API for the Leads dashboard: list leads, list call attempts for
// a lead, log a call, update a lead's outcome / quote / notes.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import type { CallStatus, Outcome } from "@/lib/customer-service/leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_CALL_STATUSES: CallStatus[] = ["not_called", "no_answer", "called"];
const ALLOWED_OUTCOMES: Outcome[] = ["new", "contacted", "quoted", "won", "lost"];

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "list";
  const supabase = getSupabase();

  if (view === "call_attempts") {
    const leadId = req.nextUrl.searchParams.get("lead_id");
    if (!leadId) return NextResponse.json({ error: "lead_id required" }, { status: 400 });
    const { data, error } = await supabase
      .from("lead_call_attempts")
      .select("*")
      .eq("lead_id", leadId)
      .order("called_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ attempts: data ?? [] });
  }

  // Default: list of leads, newest first, optionally filtered by source.
  const source = req.nextUrl.searchParams.get("source"); // null | 'website' | 'meta'
  let query = supabase.from("leads").select("*").order("submitted_at", { ascending: false });
  if (source === "website" || source === "meta") query = query.eq("source", source);

  const { data: leads, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch call attempt aggregates so the table can show "last called by X".
  const ids = (leads ?? []).map((l) => l.id);
  let attemptAgg: Map<string, { count: number; last_at: string; last_staff: string }> = new Map();
  if (ids.length > 0) {
    const { data: attempts } = await supabase
      .from("lead_call_attempts")
      .select("lead_id, staff, called_at")
      .in("lead_id", ids)
      .order("called_at", { ascending: false });
    for (const a of attempts ?? []) {
      const prev = attemptAgg.get(a.lead_id);
      if (!prev) {
        attemptAgg.set(a.lead_id, { count: 1, last_at: a.called_at, last_staff: a.staff });
      } else {
        prev.count += 1;
      }
    }
  }

  const enriched = (leads ?? []).map((l) => {
    const agg = attemptAgg.get(l.id);
    return {
      ...l,
      call_attempts_count: agg?.count ?? 0,
      last_call_at: agg?.last_at ?? null,
      last_called_by: agg?.last_staff ?? null,
    };
  });

  return NextResponse.json({ leads: enriched });
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action");
  const supabase = getSupabase();

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
  const { id, ...rest } = body as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

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
  if (rest.lost_reason === null || typeof rest.lost_reason === "string") update.lost_reason = rest.lost_reason;
  if (rest.notes === null || typeof rest.notes === "string") update.notes = rest.notes;
  if (rest.assigned_to === null || typeof rest.assigned_to === "string") update.assigned_to = rest.assigned_to;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase.from("leads").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
