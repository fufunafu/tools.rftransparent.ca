import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
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
import {
  getFollowupSummary,
  getFollowupAnalytics,
  getFollowupByStaff,
  type FollowupStaffRow,
} from "@/lib/customer-service/followup-queries";

export const dynamic = "force-dynamic";
// Matches /api/cron/sync-followup — the manual Sync button does the same work
// as the cron and was timing out at 120s with the full draft set.
export const maxDuration = 300;

const STORES = getStores().map((s) => ({ id: s.id, label: s.label, shop_domain: s.store }));

// All "today"/"yesterday" boundaries anchor to the business timezone (Montreal
// / Eastern), NOT the server's UTC clock. On Vercel the server runs in UTC, so
// d.setHours(0,…) would roll the day over at 8 PM Eastern and push the evening's
// activity into "yesterday". `businessDayStart(n)` returns the UTC instant of
// midnight, n days from today, in BUSINESS_TZ.
const BUSINESS_TZ = "America/Toronto";

function businessDayStart(offsetDays = 0): string {
  const target = new Date(Date.now() + offsetDays * 86400_000);
  // Calendar date (Y-M-D) as it reads in the business timezone.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target); // e.g. "2026-06-11"

  const wallAsUTC = new Date(`${ymd}T00:00:00Z`).getTime();
  // How far the business timezone sits from UTC at that wall time (handles DST).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(wallAsUTC));
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const easternAsUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  const offsetMs = easternAsUTC - wallAsUTC;
  return new Date(wallAsUTC - offsetMs).toISOString();
}

function todayStart() {
  return businessDayStart(0);
}

function yesterdayStart() {
  return businessDayStart(-1);
}

function tomorrowStart() {
  return businessDayStart(1);
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
      const rows = await getFollowupAnalytics(storeId);
      const months = rows.map((r) => ({
        month: r.month_key,
        label: new Date(r.month_key + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        total: r.total,
        won: r.won,
        lost: r.lost,
        quoted_value: r.quoted_value,
        won_value: r.won_value,
        conversion_rate: r.conversion_rate,
      }));
      return NextResponse.json({ months });
    }

    // ── Summary ──
    if (view === "summary") {
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));
      const summary = await getFollowupSummary(storeId, cutoff);
      if (!summary) {
        // Empty store — return zero-valued shape so the dashboard renders.
        return NextResponse.json({
          metrics: {
            due_today: 0, overdue: 0, total_active: 0, total_closed: 0,
            won_count: 0, lost_count: 0, conversion_rate: 0, avg_attempts: 0,
            avg_cycle_won: null, avg_cycle_lost: null,
            pipeline_value: 0, won_value: 0,
          },
          by_status: {},
          loss_reasons: {},
          lead_distribution: {},
          last_synced_at: null,
          stores: STORES,
        });
      }
      return NextResponse.json({
        metrics: {
          due_today: summary.due_today,
          overdue: summary.overdue,
          total_active: summary.total_active,
          total_closed: summary.total_closed,
          won_count: summary.won_count,
          lost_count: summary.lost_count,
          conversion_rate: summary.conversion_rate,
          avg_attempts: summary.avg_attempts,
          avg_cycle_won: summary.avg_cycle_won,
          avg_cycle_lost: summary.avg_cycle_lost,
          pipeline_value: summary.pipeline_value,
          won_value: summary.won_value,
        },
        by_status: summary.by_status,
        loss_reasons: summary.loss_reasons,
        lead_distribution: summary.lead_distribution,
        last_synced_at: summary.last_synced_at,
        stores: STORES,
      });
    }

    // ── Addressed-today count (for the tab badge) ──
    if (view === "addressed_today_count") {
      const PAGE = 1000;
      const seen = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from("followup_logs")
          .select("lead_id, followup_leads!inner(store_id)")
          .eq("followup_leads.store_id", storeId)
          .gte("created_at", today)
          .lt("created_at", tomorrow)
          .neq("logged_by", "system")
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        for (const r of data as { lead_id: string }[]) seen.add(r.lead_id);
        if (data.length < PAGE) break;
      }
      return NextResponse.json({ count: seen.size });
    }

    // ── Leads list ──
    if (view === "leads") {
      const filter = req.nextUrl.searchParams.get("filter") || "due_today";
      const creator = req.nextUrl.searchParams.get("creator"); // optional: "__unknown__" or a staff name
      const closeReason = req.nextUrl.searchParams.get("close_reason");
      const leadStatus = req.nextUrl.searchParams.get("lead_status"); // optional: "hot_lead", "new", etc.
      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));

      const SKIP_EMAILS = ["application@gmail.com"];
      const skipFilter = SKIP_EMAILS.map((e) => `customer_email.neq.${e}`).join(",");

      // "Addressed Today" needs the set of lead IDs that got a non-system log
      // today. Preserve the log order (newest first) so the table shows the
      // most recently worked lead on top.
      //
      // Optional drill-down params (used by RecentActivityPanel clicks):
      //   logged_by  — restrict to logs by a single staff email
      //   outcome    — "won" | "lost" (incl. duplicate) | "ongoing" (non-terminal)
      let addressedTodayIds: string[] | null = null;
      if (filter === "addressed_today") {
        const loggedByFilter = req.nextUrl.searchParams.get("logged_by");
        const outcomeFilter = req.nextUrl.searchParams.get("outcome");
        // Window the logs to match the Recent Activity panel's range, so drilling
        // from a 7d/14d/30d/All view shows the leads worked in *that* window — not
        // just today. Mirrors recent_activity's windowing. Defaults to today.
        const addressedDays = req.nextUrl.searchParams.get("addressed_days");
        let addrStart: string | null = today;
        let addrEnd: string | null = tomorrow;
        if (addressedDays === "all") {
          addrStart = null;
          addrEnd = null;
        } else if (addressedDays === "yesterday") {
          addrStart = yesterdayStart();
          addrEnd = today;
        } else if (addressedDays && addressedDays !== "today") {
          const n = parseInt(addressedDays, 10);
          if (Number.isFinite(n)) {
            addrStart = new Date(Date.now() - Math.max(1, n) * 86400_000).toISOString();
            addrEnd = null; // up to now
          }
        }

        let logQ = supabase
          .from("followup_logs")
          .select("lead_id, created_at, followup_leads!inner(store_id)")
          .eq("followup_leads.store_id", storeId)
          .neq("logged_by", "system")
          .order("created_at", { ascending: false });
        if (addrStart) logQ = logQ.gte("created_at", addrStart);
        if (addrEnd) logQ = logQ.lt("created_at", addrEnd);

        // Case-insensitive: the Recent Activity panel lowercases emails when
        // bucketing per-staff, so the drill-down always sends a lowercase
        // value. The raw `logged_by` column can hold mixed case (depends on
        // what Supabase auth returned), so `.eq` would miss those.
        if (loggedByFilter) logQ = logQ.ilike("logged_by", loggedByFilter);
        if (outcomeFilter === "won") logQ = logQ.eq("outcome", "won");
        else if (outcomeFilter === "lost") logQ = logQ.in("outcome", ["lost", "duplicate"]);
        else if (outcomeFilter === "ongoing") logQ = logQ.not("outcome", "in", "(won,lost,duplicate)");

        const { data: logRows } = await logQ;
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const r of (logRows ?? []) as { lead_id: string }[]) {
          if (!seen.has(r.lead_id)) {
            seen.add(r.lead_id);
            ordered.push(r.lead_id);
          }
        }
        addressedTodayIds = ordered;
        if (addressedTodayIds.length === 0) {
          return NextResponse.json({ leads: [], total: 0, filter, creator: creator ?? null });
        }
      }

      let query = supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", storeId)
        .or(`customer_email.is.null,${skipFilter}`);

      // Exclude OPEN (unsent works-in-progress) and DELETED (invoice recalled/voided)
      // — EXCEPT for Addressed Today. A rep can mark a lead lost AFTER the sync
      // already flagged it DELETED (Shopify draft gone). That lead still belongs
      // in today's activity drill — the rep just worked it.
      if (filter !== "addressed_today") {
        query = query.not("shopify_status", "in", "(OPEN,DELETED)");
      }

      // The Last-12-Months filter only restricts when the lead was *quoted*.
      // For Addressed Today we want every lead that got a log entry today,
      // even an old quote re-touched by the rep — so skip the cutoff here.
      if (cutoff && filter !== "addressed_today") {
        query = query.gte("shopify_created_at", cutoff);
      }

      // Default ordering by filter:
      //   - creator (Quotes-by-Staff drill-in) and due_today both prioritize
      //     newest quote first — recent leads are the warmest workload.
      //   - addressed_today reorders client-side by log time (preserved above).
      //   - everything else falls back to soonest-due first.
      //   - "everything" (active + closed in one list) reads best newest-first.
      if (creator || filter === "due_today" || filter === "everything") {
        query = query.order("shopify_created_at", { ascending: false, nullsFirst: false });
      } else if (filter !== "addressed_today") {
        query = query.order("next_followup_at", { ascending: true, nullsFirst: false });
      }

      if (filter === "due_today") {
        // Pulls today's + overdue rows together. JS-side reorder below puts
        // today's leads on top so the tab doubles as the rep's daily to-do.
        query = query
          .is("closed_at", null)
          .not("next_followup_at", "is", null)
          .lt("next_followup_at", tomorrow);
      } else if (filter === "overdue") {
        query = query.is("closed_at", null).lt("next_followup_at", today).not("next_followup_at", "is", null);
      } else if (filter === "upcoming") {
        query = query.is("closed_at", null).gte("next_followup_at", tomorrow);
      } else if (filter === "all") {
        query = query.is("closed_at", null);
      } else if (filter === "addressed_today" && addressedTodayIds) {
        query = query.in("id", addressedTodayIds);
      } else if (filter === "closed") {
        query = query.not("closed_at", "is", null).order("closed_at", { ascending: false });
      } else if (filter === "everything") {
        // "All" — no closed_at filter, so active and closed leads come back
        // together (still excludes OPEN/DELETED, same as the other tabs).
      }

      // Attribution = last invoice sender, falling back to creator (matches the
      // Quotes-by-Staff RPC). So "leads by X" = last_invoice_sender is X, OR it's
      // unset and created_by_staff is X. Values are double-quoted so names with
      // spaces/commas/parentheses (e.g. "zakaria touzami (deleted)") stay safe.
      if (creator === "__unknown__") {
        query = query.is("last_invoice_sender", null).is("created_by_staff", null);
      } else if (creator) {
        const v = creator.replace(/"/g, '');
        query = query.or(
          `last_invoice_sender.eq."${v}",and(last_invoice_sender.is.null,created_by_staff.eq."${v}")`,
        );
      }

      if (closeReason) {
        if (closeReason === "Unknown") {
          // "Unknown" is what summary shows for null close_reason on lost leads.
          query = query.eq("lead_status", "lost").is("close_reason", null);
        } else {
          query = query.eq("close_reason", closeReason);
        }
      }

      // Click-through filter from the status pills above the table.
      if (leadStatus) {
        query = query.eq("lead_status", leadStatus);
      }

      // Supabase caps a single request at 1000 rows. Paginate so the
      // table (and "Export CSV") can include every matching lead.
      const PAGE = 1000;
      let leads: FollowUpLead[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await query.range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        leads.push(...(data as FollowUpLead[]));
        if (data.length < PAGE) break;
      }

      // For "due_today" we fetched today + overdue with a single query; partition
      // them so today's leads land on top. Both buckets keep the SQL-side
      // shopify_created_at desc order — newest quotes are the warmest workload.
      if (filter === "due_today") {
        const todayLeads: FollowUpLead[] = [];
        const overdueLeads: FollowUpLead[] = [];
        for (const l of leads) {
          if (!l.next_followup_at) continue;
          if (l.next_followup_at >= today) todayLeads.push(l);
          else overdueLeads.push(l);
        }
        leads = [...todayLeads, ...overdueLeads];
      }

      // "Addressed Today": reorder to match the log-time order (most recently
      // worked lead first), since the SQL `.in()` doesn't preserve list order.
      if (filter === "addressed_today" && addressedTodayIds) {
        const pos = new Map(addressedTodayIds.map((id, i) => [id, i]));
        leads.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
      }

      return NextResponse.json({
        leads,
        total: leads.length,
        filter,
        creator: creator ?? null,
      });
    }

    // ── Per-staff breakdown ──
    if (view === "by_staff") {
      // `days` (Today/7d/14d/30d/All) takes precedence over the coarse
      // `range` (1y/all). Its cutoff floats with "now", so it can't share the
      // day-stable unstable_cache used by getFollowupByStaff — call the RPC
      // directly. The RPC already filters on shopify_created_at >= p_cutoff.
      const daysParam = req.nextUrl.searchParams.get("days");

      // "Yesterday" is a *bounded* window [yesterday 00:00, today 00:00). The
      // RPC only supports a lower cutoff, so aggregate followup_leads directly
      // to the exact same shape the RPC returns.
      if (daysParam === "yesterday") {
        const start = yesterdayStart();
        const PAGE = 1000;
        const rows: {
          created_by_staff: string | null;
          last_invoice_sender: string | null;
          lead_status: string;
          quote_amount: number | string | null;
        }[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("followup_leads")
            .select("created_by_staff, last_invoice_sender, lead_status, quote_amount")
            .eq("store_id", storeId)
            .not("shopify_status", "in", "(OPEN,DELETED)")
            .gte("shopify_created_at", start)
            .lt("shopify_created_at", today)
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          if (!data || data.length === 0) break;
          rows.push(...(data as typeof rows));
          if (data.length < PAGE) break;
        }

        interface Agg {
          staff: string; total: number; won: number; lost: number;
          active: number; quoted_value: number; won_value: number; conversion_rate: number;
        }
        const map = new Map<string, Agg>();
        for (const r of rows) {
          // Attribution = last invoice sender, falling back to creator (matches the RPC).
          const name =
            (r.last_invoice_sender && r.last_invoice_sender.trim()) ||
            (r.created_by_staff && r.created_by_staff.trim()) ||
            "Unknown";
          const agg = map.get(name) ?? {
            staff: name, total: 0, won: 0, lost: 0, active: 0,
            quoted_value: 0, won_value: 0, conversion_rate: 0,
          };
          const amt = Number(r.quote_amount) || 0;
          agg.total++;
          agg.quoted_value += amt;
          if (r.lead_status === "won") { agg.won++; agg.won_value += amt; }
          else if (r.lead_status === "lost") agg.lost++;
          else agg.active++; // matches the RPC: active = not won/lost
          map.set(name, agg);
        }
        const staff = Array.from(map.values())
          .map((a) => ({
            ...a,
            quoted_value: Math.round(a.quoted_value),
            won_value: Math.round(a.won_value),
            conversion_rate: a.total > 0 ? Math.round((a.won / a.total) * 1000) / 10 : 0,
          }))
          .sort((x, y) => y.total - x.total);
        return NextResponse.json({ staff });
      }

      if (daysParam) {
        let cutoff: string | null;
        if (daysParam === "all") {
          cutoff = null;
        } else if (daysParam === "today") {
          cutoff = today;
        } else {
          const d = parseInt(daysParam, 10);
          const n = Number.isFinite(d) ? Math.max(1, d) : 7;
          cutoff = new Date(Date.now() - n * 86400_000).toISOString();
        }
        const { data, error } = await supabase.rpc("cs_followup_by_staff", {
          p_store_id: storeId,
          p_cutoff: cutoff,
        });
        if (error) throw new Error(error.message);
        // PostgREST can return numeric columns as strings — coerce so the
        // client gets real numbers (matches getFollowupByStaff).
        const staff = (data ?? []).map((r: FollowupStaffRow) => ({
          staff: r.staff,
          total: Number(r.total),
          won: Number(r.won),
          lost: Number(r.lost),
          active: Number(r.active),
          quoted_value: Number(r.quoted_value),
          won_value: Number(r.won_value),
          conversion_rate: Number(r.conversion_rate),
        }));
        return NextResponse.json({ staff });
      }

      const cutoff = rangeCutoff(req.nextUrl.searchParams.get("range"));
      const staff = await getFollowupByStaff(storeId, cutoff);
      return NextResponse.json({ staff });
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
        // Attribution = last invoice sender, falling back to creator (matches by_staff).
        if (staffParam === "__unknown__") {
          q = q.is("last_invoice_sender", null).is("created_by_staff", null);
        } else {
          const v = staffParam.replace(/"/g, '');
          q = q.or(
            `last_invoice_sender.eq."${v}",and(last_invoice_sender.is.null,created_by_staff.eq."${v}")`,
          );
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

    // ── Recent follow-up activity by staff ──
    // Aggregates followup_logs in a sliding window so we can answer
    // "who actually worked the queue this week?" — separate from
    // `by_staff` which counts who *created* the quotes.
    if (view === "recent_activity") {
      const daysParam = req.nextUrl.searchParams.get("days") ?? "7";
      let days: number | "today" | "yesterday" | "all";
      let cutoff: string | null;
      // Optional upper bound — only "yesterday" is a bounded window; the others
      // run from `cutoff` up to now.
      let until: string | null = null;
      if (daysParam === "all") {
        days = "all";
        cutoff = null;
      } else if (daysParam === "today") {
        // Calendar day, not a rolling 24h window — anchored at server-local
        // midnight (same anchor as `todayStart()` used elsewhere in this route).
        days = "today";
        cutoff = today;
      } else if (daysParam === "yesterday") {
        // Bounded calendar day: [yesterday 00:00, today 00:00).
        days = "yesterday";
        cutoff = yesterdayStart();
        until = today;
      } else {
        const daysRaw = parseInt(daysParam, 10);
        days = Number.isFinite(daysRaw) ? Math.max(1, daysRaw) : 7;
        cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      }

      const PAGE = 1000;
      const rows: {
        logged_by: string;
        outcome: string;
        created_at: string;
        followup_leads: { store_id: string } | null;
      }[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("followup_logs")
          .select("logged_by, outcome, created_at, followup_leads!inner(store_id)")
          .eq("followup_leads.store_id", storeId)
          // "system" logs are sync-time auto-wins (Shopify reported the draft
          // completed without a rep logging it) — not real follow-up activity.
          .neq("logged_by", "system")
          .order("created_at", { ascending: false });
        if (cutoff) q = q.gte("created_at", cutoff);
        if (until) q = q.lt("created_at", until);
        const { data } = await q.range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        // PostgREST returns the joined row as an object when using !inner, but the
        // generated types think it's an array — coerce defensively.
        for (const r of data as Array<{
          logged_by: string;
          outcome: string;
          created_at: string;
          followup_leads: { store_id: string } | { store_id: string }[] | null;
        }>) {
          const fl = Array.isArray(r.followup_leads) ? r.followup_leads[0] ?? null : r.followup_leads;
          rows.push({
            logged_by: r.logged_by,
            outcome: r.outcome,
            created_at: r.created_at,
            followup_leads: fl,
          });
        }
        if (data.length < PAGE) break;
      }

      // Resolve display names: one query, build email → name map.
      // Index both `email` (work identity) and `email_alt` (personal sign-in)
      // so reps who logged the follow-up under either address still get their
      // real name shown in the activity table.
      const nameMap = new Map<string, string>();
      try {
        const { data: emps } = await supabase
          .from("employees")
          .select("email, email_alt, name");
        for (const e of (emps ?? []) as { email: string | null; email_alt: string | null; name: string }[]) {
          if (e.email) nameMap.set(e.email.toLowerCase(), e.name);
          if (e.email_alt) nameMap.set(e.email_alt.toLowerCase(), e.name);
        }
      } catch {
        // employees table or columns may not exist in all environments —
        // fall back to email-only display.
      }

      interface StaffAgg {
        email: string;
        name: string;
        total: number;
        won: number;
        lost: number;
        ongoing: number;
        last_at: string;
      }

      // Fallback display name when an email isn't in the employees table:
      // turn "yousif@glass-railing.com" into "Yousif" so the table never
      // shows a raw address.
      const displayFromEmail = (email: string): string => {
        const local = email.split("@")[0] ?? email;
        return local
          .split(/[._-]+/)
          .filter(Boolean)
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(" ") || email;
      };

      const byEmail = new Map<string, StaffAgg>();
      for (const r of rows) {
        const email = (r.logged_by || "unknown").toLowerCase();
        const agg = byEmail.get(email) ?? {
          email,
          name: nameMap.get(email) ?? displayFromEmail(email),
          total: 0,
          won: 0,
          lost: 0,
          ongoing: 0,
          last_at: r.created_at,
        };
        agg.total++;
        if (r.outcome === "won") agg.won++;
        // "duplicate" is a close, not a real loss, but it's still terminal — group with lost
        // for the headline outcome breakdown.
        else if (r.outcome === "lost" || r.outcome === "duplicate") agg.lost++;
        else agg.ongoing++;
        if (r.created_at > agg.last_at) agg.last_at = r.created_at;
        byEmail.set(email, agg);
      }

      const staff = Array.from(byEmail.values()).sort((a, b) => b.total - a.total);

      return NextResponse.json({ days, total: rows.length, staff });
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
      revalidateTag(`cs:followup:${storeId}`, "max");
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

      revalidateTag(`cs:followup:${storeId}`, "max");
      return NextResponse.json({ status: "success", lead: updatedLead });
    }

    // ── Re-quote: reset the follow-up clock without creating a new quote ──
    // Used when an existing quote changes (e.g. new measurements) or a lead that
    // was lost to unresponsiveness comes back. Resets the follow-up counter,
    // reschedules the first follow-up, reopens the lead if it was closed, and
    // stamps requoted_at so it can show the re-quote date.
    if (action === "requote") {
      const body = await req.json();
      const { lead_id } = body as { lead_id: string };
      if (!lead_id) {
        return NextResponse.json({ error: "lead_id required" }, { status: 400 });
      }

      const supabase = getSupabase();
      const now = new Date().toISOString();
      const storeDays = await getFollowupDaysForStore(storeId);
      const nextFollowup = computeNextFollowup("new", storeDays);

      const { data: updatedLead, error: updateError } = await supabase
        .from("followup_leads")
        .update({
          lead_status: "new",
          followup_count: 0,
          next_followup_at: nextFollowup,
          closed_at: null,
          close_reason: null,
          updated_at: now,
        })
        .eq("id", lead_id)
        .select()
        .single();
      if (updateError) throw new Error(updateError.message);

      // Best-effort date stamp — the requoted_at column is optional. If the
      // migration hasn't run yet this errors silently; the reset above still works.
      const { error: stampErr } = await supabase
        .from("followup_leads")
        .update({ requoted_at: now })
        .eq("id", lead_id);
      if (stampErr) console.warn("[Follow-up requote] requoted_at not stamped:", stampErr.message);

      // Record it in the lead's history.
      await supabase.from("followup_logs").insert({
        lead_id,
        outcome: "new",
        notes: "Re-quoted — follow-up reset and quote re-dated.",
        logged_by: loggedBy,
      });

      revalidateTag(`cs:followup:${storeId}`, "max");
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

      revalidateTag(`cs:followup:${storeId}`, "max");
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
    // PATCH body doesn't include storeId — invalidate at the coarse tag.
    // Manual edits are rare; broader invalidation is fine here.
    revalidateTag("cs:followup", "max");
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
