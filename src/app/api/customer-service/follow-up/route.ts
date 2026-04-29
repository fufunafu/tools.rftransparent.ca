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

const STORES = getStores().map((s) => ({ id: s.id, label: s.label, shop_domain: s.store }));

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

/** Resolve a ?range=1y|all param into a cutoff ISO timestamp, or null for "all time". */
function rangeCutoff(range: string | null): string | null {
  if (!range || range === "all") return null;
  // Default (including "1y"): last 365 days.
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
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
      const allLeads: { shopify_created_at: string | null; lead_status: string; quote_amount: number; closed_at: string | null }[] = [];
      {
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data } = await supabase
            .from("followup_leads")
            .select("shopify_created_at, lead_status, quote_amount, closed_at")
            .eq("store_id", storeId)
            .range(from, from + PAGE - 1);
          if (!data || data.length === 0) break;
          allLeads.push(...data as typeof allLeads);
          if (data.length < PAGE) break;
          from += PAGE;
        }
      }

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
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));
      // Active and closed leads — paginate past PostgREST's 1000-row server cap
      const PAGE = 1000;
      const activeLeads: FollowUpLead[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("followup_leads").select("*")
          .eq("store_id", storeId).is("closed_at", null)
          // Exclude OPEN (unsent works-in-progress) and DELETED (draft no longer in Shopify's
          // invoice_sent state — usually invoice recalled/voided). Neither is a real quote.
          .not("shopify_status", "in", "(OPEN,DELETED)");
        if (cutoff) q = q.gte("shopify_created_at", cutoff);
        const { data } = await q.range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        activeLeads.push(...data as FollowUpLead[]);
        if (data.length < PAGE) break;
      }
      const closedLeads: FollowUpLead[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("followup_leads").select("*")
          .eq("store_id", storeId).not("closed_at", "is", null)
          .not("shopify_status", "in", "(OPEN,DELETED)");
        if (cutoff) q = q.gte("shopify_created_at", cutoff);
        const { data } = await q.range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        closedLeads.push(...data as FollowUpLead[]);
        if (data.length < PAGE) break;
      }

      const active = activeLeads;
      const closed = closedLeads;

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

      // Last sync time — max last_synced_at across all leads, no extra query needed
      const allLeads = [...active, ...closed];
      const lastSyncedAt = allLeads.reduce((max: string | null, l) => {
        if (!l.last_synced_at) return max;
        if (!max) return l.last_synced_at;
        return l.last_synced_at > max ? l.last_synced_at : max;
      }, null);

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
        last_synced_at: lastSyncedAt,
        stores: STORES,
      });
    }

    // ── Leads list ──
    if (view === "leads") {
      const filter = req.nextUrl.searchParams.get("filter") || "due_today";
      const creator = req.nextUrl.searchParams.get("creator"); // optional: "__unknown__" or a staff name
      const closeReason = req.nextUrl.searchParams.get("close_reason");
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));

      const SKIP_EMAILS = ["application@gmail.com"];
      const skipFilter = SKIP_EMAILS.map((e) => `customer_email.neq.${e}`).join(",");

      let query = supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .or(`customer_email.is.null,${skipFilter}`)
        // Exclude OPEN (unsent works-in-progress) and DELETED (invoice recalled/voided).
        .not("shopify_status", "in", "(OPEN,DELETED)");

      if (cutoff) {
        query = query.gte("shopify_created_at", cutoff);
      }

      // When filtering by creator (from a Quotes-by-Staff click), order by
      // newest draft first — that's the most useful view for spot-checking.
      if (creator) {
        query = query.order("shopify_created_at", { ascending: false, nullsFirst: false });
      } else {
        query = query.order("next_followup_at", { ascending: true, nullsFirst: false });
      }

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

      if (creator === "__unknown__") {
        query = query.is("created_by_staff", null);
      } else if (creator) {
        query = query.eq("created_by_staff", creator);
      }

      if (closeReason) {
        if (closeReason === "Unknown") {
          // "Unknown" is what summary shows for null close_reason on lost leads.
          query = query.eq("lead_status", "lost").is("close_reason", null);
        } else {
          query = query.eq("close_reason", closeReason);
        }
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return NextResponse.json({
        leads: data ?? [],
        total: (data ?? []).length,
        filter,
        creator: creator ?? null,
      });
    }

    // ── Per-staff breakdown ──
    if (view === "by_staff") {
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));
      const PAGE = 1000;
      const rows: { created_by_staff: string | null; lead_status: string; quote_amount: number }[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("followup_leads")
          .select("created_by_staff, lead_status, quote_amount")
          .eq("store_id", storeId)
          // Exclude OPEN (unsent works-in-progress) and DELETED (invoice recalled/voided).
          .not("shopify_status", "in", "(OPEN,DELETED)");
        if (cutoff) q = q.gte("shopify_created_at", cutoff);
        const { data } = await q.range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        rows.push(...(data as typeof rows));
        if (data.length < PAGE) break;
      }

      interface StaffAgg {
        staff: string;
        total: number;
        won: number;
        lost: number;
        active: number;
        quoted_value: number;
        won_value: number;
        conversion_rate: number;
      }

      const byStaff = new Map<string, StaffAgg>();
      for (const r of rows) {
        const staff = r.created_by_staff?.trim() || "Unknown";
        const a = byStaff.get(staff) ?? {
          staff, total: 0, won: 0, lost: 0, active: 0,
          quoted_value: 0, won_value: 0, conversion_rate: 0,
        };
        a.total++;
        a.quoted_value += Number(r.quote_amount);
        if (r.lead_status === "won") { a.won++; a.won_value += Number(r.quote_amount); }
        else if (r.lead_status === "lost") a.lost++;
        else a.active++;
        byStaff.set(staff, a);
      }

      const staffList = Array.from(byStaff.values()).map((a) => {
        // Conversion rate = won / total (treats active quotes as not-yet-converted).
        a.conversion_rate = a.total > 0 ? Math.round((a.won / a.total) * 1000) / 10 : 0;
        a.quoted_value = Math.round(a.quoted_value);
        a.won_value = Math.round(a.won_value);
        return a;
      }).sort((a, b) => b.total - a.total);

      return NextResponse.json({ staff: staffList });
    }

    // ── Per-staff monthly time-series ──
    // Same filters as `by_staff` (OPEN/DELETED excluded, same range), but
    // restricted to a single staff name and bucketed by month of creation.
    // Used by the staff detail drawer in FollowUpDashboard.
    if (view === "by_staff_monthly") {
      const staffParam = req.nextUrl.searchParams.get("staff");
      if (!staffParam) {
        return NextResponse.json({ error: "staff required" }, { status: 400 });
      }
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));

      const PAGE = 1000;
      const rows: {
        shopify_created_at: string | null;
        closed_at: string | null;
        lead_status: string;
        quote_amount: number;
      }[] = [];

      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("followup_leads")
          .select("shopify_created_at, closed_at, lead_status, quote_amount")
          .eq("store_id", storeId)
          .not("shopify_status", "in", "(OPEN,DELETED)");
        if (cutoff) q = q.gte("shopify_created_at", cutoff);
        if (staffParam === "__unknown__") {
          q = q.is("created_by_staff", null);
        } else {
          q = q.eq("created_by_staff", staffParam);
        }
        const { data } = await q.range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        rows.push(...(data as typeof rows));
        if (data.length < PAGE) break;
      }

      // Lifetime-in-range totals (mirrors the by_staff aggregation so the cards
      // in the drawer match the row in the Quotes-by-Staff breakdown).
      const totals = { total: 0, won: 0, lost: 0, active: 0, quoted_value: 0, won_value: 0, conversion_rate: 0 };
      for (const r of rows) {
        totals.total++;
        totals.quoted_value += Number(r.quote_amount);
        if (r.lead_status === "won") { totals.won++; totals.won_value += Number(r.quote_amount); }
        else if (r.lead_status === "lost") totals.lost++;
        else totals.active++;
      }
      totals.conversion_rate = totals.total > 0 ? Math.round((totals.won / totals.total) * 1000) / 10 : 0;
      totals.quoted_value = Math.round(totals.quoted_value);
      totals.won_value = Math.round(totals.won_value);

      // Monthly bucketing (same shape as the `analytics` view).
      const monthMap = new Map<string, { total: number; won: number; lost: number; quoted_value: number; won_value: number }>();
      for (const r of rows) {
        const dateStr = r.shopify_created_at || r.closed_at;
        if (!dateStr) continue;
        const month = dateStr.slice(0, 7);
        const entry = monthMap.get(month) ?? { total: 0, won: 0, lost: 0, quoted_value: 0, won_value: 0 };
        entry.total++;
        entry.quoted_value += Number(r.quote_amount);
        if (r.lead_status === "won") { entry.won++; entry.won_value += Number(r.quote_amount); }
        if (r.lead_status === "lost") entry.lost++;
        monthMap.set(month, entry);
      }

      const months = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, d]) => ({
          month,
          label: new Date(month + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          total: d.total,
          won: d.won,
          lost: d.lost,
          quoted_value: Math.round(d.quoted_value),
          won_value: Math.round(d.won_value),
          // won / total across the month — matches StaffBreakdown's lifetime definition,
          // so the line chart and the card stay internally consistent.
          conversion_rate: d.total > 0 ? Math.round((d.won / d.total) * 1000) / 10 : 0,
        }));

      return NextResponse.json({ staff: staffParam, totals, months });
    }

    // ── Lost leads + the closing note from followup_logs ──
    // The note the user types when marking a lead Lost is stored on
    // followup_logs (per-attempt), not on followup_leads. This view joins
    // the most recent outcome=lost log onto each lead so the loss-reasons
    // drill-down can show *why*.
    if (view === "lost_details") {
      const closeReason = req.nextUrl.searchParams.get("close_reason");
      if (!closeReason) {
        return NextResponse.json({ error: "close_reason required" }, { status: 400 });
      }
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));

      let leadsQ = supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .eq("lead_status", "lost")
        .order("closed_at", { ascending: false });

      if (closeReason === "Unknown") {
        leadsQ = leadsQ.is("close_reason", null);
      } else {
        leadsQ = leadsQ.eq("close_reason", closeReason);
      }
      if (cutoff) leadsQ = leadsQ.gte("shopify_created_at", cutoff);

      const { data: leadsData, error: leadsErr } = await leadsQ;
      if (leadsErr) throw new Error(leadsErr.message);
      const leads = (leadsData ?? []) as FollowUpLead[];

      const ids = leads.map((l) => l.id);
      const noteByLead = new Map<string, string>();
      if (ids.length > 0) {
        const { data: logs } = await supabase
          .from("followup_logs")
          .select("lead_id, notes, created_at")
          .in("lead_id", ids)
          .eq("outcome", "lost")
          .order("created_at", { ascending: false });
        for (const row of (logs ?? []) as { lead_id: string; notes: string | null }[]) {
          // First (most recent) lost log wins; later ones for the same lead are ignored.
          if (row.notes && !noteByLead.has(row.lead_id)) {
            noteByLead.set(row.lead_id, row.notes);
          }
        }
      }

      const enriched = leads.map((l) => ({ ...l, closing_note: noteByLead.get(l.id) ?? null }));
      return NextResponse.json({ leads: enriched, total: enriched.length });
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
      return NextResponse.json({ status: "success", synced_at: new Date().toISOString(), ...result });
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
