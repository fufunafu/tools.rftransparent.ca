import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import {
  syncDraftOrdersForStore,
  computeNextFollowup,
  getFollowupDaysForStore,
  DEFAULT_FOLLOWUP_DAYS,
  FOLLOWUP_CATEGORIES,
  MAX_ATTEMPTS,
  type LeadStatus,
  type FollowUpLead,
} from "@/lib/followup";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STORES = getStores().map((s) => ({ id: s.id, label: s.label }));

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function tomorrowStart() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view") || "summary";
  const storeId = req.nextUrl.searchParams.get("store") || STORES[0]?.id;

  if (!storeId) {
    return NextResponse.json({ error: "No stores configured" }, { status: 400 });
  }

  const supabase = getSupabase();
  const today = todayStart();
  const tomorrow = tomorrowStart();

  try {
    if (view === "stores") {
      return NextResponse.json({ stores: STORES });
    }

    // ── Config (follow-up days per category) ──
    if (view === "config") {
      const storeDays = await getFollowupDaysForStore(storeId);
      return NextResponse.json({ config: storeDays, defaults: DEFAULT_FOLLOWUP_DAYS });
    }

    // ── Analytics (monthly trends) ──
    if (view === "analytics") {
      const { data: allLeads } = await supabase
        .from("followup_leads")
        .select("shopify_created_at, lead_status, quote_amount, closed_at")
        .eq("store_id", storeId);

      const monthMap = new Map<string, { total: number; won: number; lost: number; quoted_value: number; won_value: number }>();

      for (const lead of (allLeads ?? []) as { shopify_created_at: string | null; lead_status: string; quote_amount: number; closed_at: string | null }[]) {
        const dateStr = lead.shopify_created_at || lead.closed_at;
        if (!dateStr) continue;
        const month = dateStr.slice(0, 7); // "YYYY-MM"
        const entry = monthMap.get(month) ?? { total: 0, won: 0, lost: 0, quoted_value: 0, won_value: 0 };
        entry.total++;
        entry.quoted_value += Number(lead.quote_amount);
        if (lead.lead_status === "won") { entry.won++; entry.won_value += Number(lead.quote_amount); }
        if (lead.lead_status === "lost") entry.lost++;
        monthMap.set(month, entry);
      }

      const months = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, d]) => ({
          month,
          label: new Date(month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          ...d,
          conversion_rate: (d.won + d.lost) > 0 ? Math.round((d.won / (d.won + d.lost)) * 1000) / 10 : 0,
        }));

      return NextResponse.json({ months });
    }

    // ── Summary ──
    if (view === "summary") {
      // Active leads (not closed)
      const { data: activeLeads } = await supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .is("closed_at", null);

      // Closed leads
      const { data: closedLeads } = await supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .not("closed_at", "is", null);

      const active = (activeLeads ?? []) as FollowUpLead[];
      const closed = (closedLeads ?? []) as FollowUpLead[];

      const dueToday = active.filter(
        (l) => l.next_followup_at && l.next_followup_at >= today && l.next_followup_at < tomorrow
      ).length;

      const overdue = active.filter(
        (l) => l.next_followup_at && l.next_followup_at < today
      ).length;

      const wonLeads = closed.filter((l) => l.lead_status === "won");
      const lostLeads = closed.filter((l) => l.lead_status === "lost");
      const totalClosedNonDup = wonLeads.length + lostLeads.length;
      const conversionRate = totalClosedNonDup > 0
        ? Math.round((wonLeads.length / totalClosedNonDup) * 1000) / 10
        : 0;

      const wonValue = wonLeads.reduce((s, l) => s + Number(l.quote_amount), 0);
      const pipelineValue = active.reduce((s, l) => s + Number(l.quote_amount), 0);

      // Status breakdown
      const byStatus: Record<string, number> = {};
      for (const l of active) {
        byStatus[l.lead_status] = (byStatus[l.lead_status] || 0) + 1;
      }

      // Loss reason breakdown
      const lossReasons: Record<string, number> = {};
      for (const l of lostLeads) {
        const reason = l.close_reason || "Unknown";
        lossReasons[reason] = (lossReasons[reason] || 0) + 1;
      }

      // Avg cycle time (days from quote to close)
      function avgCycleDays(leads: FollowUpLead[]): number | null {
        const withDates = leads.filter((l) => l.shopify_created_at && l.closed_at);
        if (withDates.length === 0) return null;
        const totalDays = withDates.reduce((s, l) => {
          const from = new Date(l.shopify_created_at!).getTime();
          const to = new Date(l.closed_at!).getTime();
          return s + (to - from) / (1000 * 60 * 60 * 24);
        }, 0);
        return Math.round((totalDays / withDates.length) * 10) / 10;
      }

      // Avg follow-up attempts for closed leads
      const closedWithAttempts = closed.filter((l) => l.followup_count > 0);
      const avgAttempts = closedWithAttempts.length > 0
        ? Math.round((closedWithAttempts.reduce((s, l) => s + l.followup_count, 0) / closedWithAttempts.length) * 10) / 10
        : 0;

      return NextResponse.json({
        metrics: {
          due_today: dueToday,
          overdue,
          total_active: active.length,
          total_closed: closed.length,
          won_count: wonLeads.length,
          lost_count: lostLeads.length,
          conversion_rate: conversionRate,
          avg_attempts: avgAttempts,
          avg_cycle_won: avgCycleDays(wonLeads),
          avg_cycle_lost: avgCycleDays(lostLeads),
          pipeline_value: Math.round(pipelineValue),
          won_value: Math.round(wonValue),
        },
        by_status: byStatus,
        loss_reasons: lossReasons,
        stores: STORES,
      });
    }

    // ── Leads list ──
    if (view === "leads") {
      const filter = req.nextUrl.searchParams.get("filter") || "due_today";

      let query = supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .order("next_followup_at", { ascending: true, nullsFirst: false });

      if (filter === "due_today") {
        query = query.is("closed_at", null).gte("next_followup_at", today).lt("next_followup_at", tomorrow);
      } else if (filter === "overdue") {
        query = query.is("closed_at", null).lt("next_followup_at", today).not("next_followup_at", "is", null);
      } else if (filter === "upcoming") {
        query = query.is("closed_at", null).gte("next_followup_at", tomorrow);
      } else if (filter === "all") {
        query = query.is("closed_at", null);
      } else if (filter === "closed") {
        query = query.not("closed_at", "is", null).order("closed_at", { ascending: false });
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return NextResponse.json({
        leads: data ?? [],
        total: (data ?? []).length,
        filter,
      });
    }

    // ── Logs for a lead ──
    if (view === "logs") {
      const leadId = req.nextUrl.searchParams.get("lead_id");
      if (!leadId) {
        return NextResponse.json({ error: "lead_id required" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("followup_logs")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return NextResponse.json({ logs: data ?? [] });
    }

    return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  } catch (err) {
    console.error("[Follow-up API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch follow-up data" },
      { status: 500 },
    );
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loggedBy = user.email ?? "unknown";
  const action = req.nextUrl.searchParams.get("action");
  const storeId = req.nextUrl.searchParams.get("store") || STORES[0]?.id;

  if (!storeId) {
    return NextResponse.json({ error: "No stores configured" }, { status: 400 });
  }

  try {
    // ── Sync draft orders from Shopify ──
    if (action === "sync") {
      const store = getStores().find((s) => s.id === storeId);
      if (!store) {
        return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400 });
      }

      const result = await syncDraftOrdersForStore(storeId);
      return NextResponse.json({ status: "success", ...result });
    }

    // ── Log a follow-up attempt ──
    if (action === "log") {
      const body = await req.json();
      const { lead_id, outcome, notes, close_reason, custom_date } = body as {
        lead_id: string;
        outcome: LeadStatus;
        notes?: string;
        close_reason?: string;
        custom_date?: string;
      };

      if (!lead_id || !outcome) {
        return NextResponse.json({ error: "lead_id and outcome required" }, { status: 400 });
      }

      if (!(outcome in FOLLOWUP_CATEGORIES)) {
        return NextResponse.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 });
      }

      const supabase = getSupabase();
      const now = new Date().toISOString();
      const cat = FOLLOWUP_CATEGORIES[outcome];

      // Insert log entry
      const { error: logError } = await supabase.from("followup_logs").insert({
        lead_id,
        outcome,
        notes: notes || null,
        logged_by: loggedBy,
      });
      if (logError) throw new Error(logError.message);

      // Update lead — use store-specific follow-up days
      const storeDays = await getFollowupDaysForStore(storeId);
      const nextFollowup = computeNextFollowup(outcome, storeDays, custom_date);
      const updateData: Record<string, unknown> = {
        lead_status: outcome,
        next_followup_at: nextFollowup,
        updated_at: now,
      };

      // Increment followup_count (need to read current first)
      const { data: currentLead } = await supabase
        .from("followup_leads")
        .select("followup_count")
        .eq("id", lead_id)
        .single();

      updateData.followup_count = (currentLead?.followup_count ?? 0) + 1;

      if (cat.terminal) {
        updateData.closed_at = now;
        if (outcome === "lost" && close_reason) {
          updateData.close_reason = close_reason;
        }
      }

      const { data: updatedLead, error: updateError } = await supabase
        .from("followup_leads")
        .update(updateData)
        .eq("id", lead_id)
        .select()
        .single();

      if (updateError) throw new Error(updateError.message);

      return NextResponse.json({ status: "success", lead: updatedLead });
    }

    // ── Bulk close leads ──
    if (action === "bulk_close") {
      const body = await req.json();
      const { lead_ids, status, close_reason } = body as {
        lead_ids: string[];
        status: "lost" | "duplicate";
        close_reason?: string;
      };

      if (!lead_ids?.length || !status) {
        return NextResponse.json({ error: "lead_ids and status required" }, { status: 400 });
      }

      const supabase = getSupabase();
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("followup_leads")
        .update({
          lead_status: status,
          closed_at: now,
          next_followup_at: null,
          close_reason: close_reason || null,
          updated_at: now,
        })
        .in("id", lead_ids);

      if (updateError) throw new Error(updateError.message);

      // Insert log entries
      const logs = lead_ids.map((id) => ({
        lead_id: id,
        outcome: status,
        notes: close_reason ? `Bulk closed: ${close_reason}` : "Bulk closed",
        logged_by: loggedBy,
      }));

      await supabase.from("followup_logs").insert(logs);

      return NextResponse.json({ status: "success", closed: lead_ids.length });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[Follow-up API POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Follow-up action failed" },
      { status: 500 },
    );
  }
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { id, notes, next_followup_at, lead_status, close_reason } = body as {
      id: string;
      notes?: string;
      next_followup_at?: string;
      lead_status?: LeadStatus;
      close_reason?: string;
    };

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updated_at: now };

    if (notes !== undefined) updateData.notes = notes;
    if (next_followup_at !== undefined) updateData.next_followup_at = next_followup_at;

    if (lead_status) {
      updateData.lead_status = lead_status;
      const cat = FOLLOWUP_CATEGORIES[lead_status];
      if (cat?.terminal) {
        updateData.closed_at = now;
        updateData.next_followup_at = null;
        if (close_reason) updateData.close_reason = close_reason;
      }
    }

    const { data, error } = await supabase
      .from("followup_leads")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ status: "success", lead: data });
  } catch (err) {
    console.error("[Follow-up API PATCH]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}

// ─── PUT (save config) ──────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { store_id, config } = body as { store_id: string; config: Record<string, number | null> };

    if (!store_id || !config) {
      return NextResponse.json({ error: "store_id and config required" }, { status: 400 });
    }

    const supabase = getSupabase();
    const rows = Object.entries(config).map(([category, followup_days]) => ({
      store_id,
      category,
      followup_days,
    }));

    const { error } = await supabase
      .from("followup_config")
      .upsert(rows, { onConflict: "store_id,category" });

    if (error) throw new Error(error.message);
    return NextResponse.json({ status: "success" });
  } catch (err) {
    console.error("[Follow-up API PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Config save failed" },
      { status: 500 },
    );
  }
}
