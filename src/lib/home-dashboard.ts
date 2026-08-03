import { getSupabase } from "@/lib/supabase";
import { getStores, fetchAllPages, calcNetRevenue, REVENUE_FIELDS, type RevenueFields } from "@/lib/shopify";
import { cached } from "@/lib/api-cache";
import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";
import { getLatestCronRuns, type CronRun } from "@/lib/cron-monitor";
import { AUTOMATION_JOBS } from "@/lib/automations";

// Data behind the home page. Every getter resolves to a value OR an error
// string — never throws — because the home page is the first thing loaded
// after login and one unreachable service (Shopify, an unapplied migration)
// must degrade a single tile rather than blank the whole page.

// How stale a tile may be. Shopify is the slow one and its numbers move by
// the minute at most; the Supabase counts are cheap enough to read live.
// Matches OPS_TTL_MS in ops-dashboard.ts so home and the wall board tell the
// same sales story instead of disagreeing for up to five minutes.
const SALES_TTL_MS = 5 * 60 * 1000;

// Age at which the longest-open ticket gets called out. Deliberately well past
// a week: most open tickets are older than that, so a 7-day bar would flag the
// standing backlog every single day and teach everyone to ignore the list.
const STALE_TICKET_ALERT_DAYS = 30;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail(err: unknown, fallback: string): Result<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface SalesToday {
  revenue: number;
  orders: number;
  /**
   * Mean revenue booked by this time of day over the prior days. Null when
   * there's no history. Clipped to the current hour so a half-finished day
   * isn't compared against full ones — at 10am every day looks catastrophic
   * against a full-day average, and the tile would cry wolf every morning.
   */
  priorAverage: number | null;
  /** Days behind priorAverage — stated so the page can't imply more. */
  priorDays: number;
  /** Stores that failed; their revenue is missing from the totals above. */
  failedStores: string[];
  /** True when a store hit the page cap, so the totals are a floor, not exact. */
  truncated: boolean;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIMEZONE,
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

// Toronto calendar day (YYYY-MM-DD) an instant falls on. Orders are stamped in
// UTC, so a 9pm Toronto order is "tomorrow" without this.
function businessDayKey(iso: string): string {
  return DAY_FORMAT.format(new Date(iso));
}

/** Minutes since Toronto midnight — how far into the business day an instant is. */
function minutesIntoDay(date: Date): number {
  const [h, m] = TIME_FORMAT.format(date).split(":");
  return Number(h) * 60 + Number(m);
}

const ORDERS_SINCE_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 250, after: $after, query: $filter) {
      edges {
        node {
          createdAt
          ${REVENUE_FIELDS}
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface DatedOrder extends RevenueFields {
  createdAt: string;
}

/**
 * Today's net revenue across every configured store, plus a like-for-like
 * average of the prior `window` days for context.
 *
 * One query per store covering the whole window — bucketing by Toronto day
 * happens here rather than in N separate per-day queries.
 */
async function computeSalesToday(window = 7): Promise<SalesToday> {
  const now = new Date();
  const todayKey = businessDayKey(now.toISOString());
  const cutoffMinutes = minutesIntoDay(now);
  const windowStart = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -window);
  const filter = `created_at:>='${windowStart.toISOString()}'`;

  const byDay = new Map<string, { revenue: number; orders: number }>();
  // Prior days counted only up to the current time of day, for the comparison.
  const priorToHour = new Map<string, number>();
  const failedStores: string[] = [];
  let truncated = false;

  const stores = getStores();
  const results = await Promise.allSettled(
    stores.map((store) =>
      fetchAllPages<DatedOrder, { orders: { edges: { node: DatedOrder; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>({
        storeId: store.id,
        query: ORDERS_SINCE_QUERY,
        variables: { filter },
        getConnection: (data) => data.orders,
        // A week of orders across a busy store; well clear in practice, and
        // `truncated` tells the page when it wasn't.
        maxPages: 10,
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failedStores.push(stores[i].label);
      return;
    }
    if (result.value.truncated) truncated = true;
    for (const order of result.value.nodes) {
      const placed = new Date(order.createdAt);
      const key = businessDayKey(order.createdAt);
      const revenue = calcNetRevenue(order);

      const bucket = byDay.get(key) ?? { revenue: 0, orders: 0 };
      bucket.revenue += revenue;
      bucket.orders += 1;
      byDay.set(key, bucket);

      if (key < todayKey && minutesIntoDay(placed) <= cutoffMinutes) {
        priorToHour.set(key, (priorToHour.get(key) ?? 0) + revenue);
      }
    }
  });

  const today = byDay.get(todayKey) ?? { revenue: 0, orders: 0 };
  const priorTotal = [...priorToHour.values()].reduce((sum, v) => sum + v, 0);

  return {
    revenue: today.revenue,
    orders: today.orders,
    // Divide by the full window, not just days that saw an order — a zero-sale
    // day is real and belongs in the average.
    priorAverage: priorToHour.size > 0 ? priorTotal / window : null,
    priorDays: window,
    failedStores,
    truncated,
  };
}

export async function getSalesToday(): Promise<Result<SalesToday & { cachedAt: string | null }>> {
  try {
    if (getStores().length === 0) {
      return { ok: false, error: "No Shopify stores are configured." };
    }
    // Cache key carries the Toronto day so the first request after midnight
    // can't serve yesterday's total as today's.
    const dayKey = businessDayKey(new Date().toISOString());
    const { data, cachedAt } = await cached(`home:sales:${dayKey}`, SALES_TTL_MS, () => computeSalesToday());
    return ok({ ...data, cachedAt });
  } catch (err) {
    return fail(err, "Could not reach Shopify.");
  }
}

// ─── Problem tickets ─────────────────────────────────────────────────────────

export interface TicketStats {
  open: number;
  /** Open tickets already past the alert age — the "9 over 30d" figure. */
  overAlertAge: number;
  /** The longest-open ticket, with its age in days. Null when none are open. */
  oldest: { client_name: string; ticket_date: string; ageDays: number } | null;
  /** Age at which the oldest ticket is worth calling out on the page. */
  alertDays: number;
}

export async function getTicketStats(): Promise<Result<TicketStats>> {
  try {
    const supabase = getSupabase();

    const alertCutoff = startOfDayInTimeZone(new Date(), BUSINESS_TIMEZONE, -STALE_TICKET_ALERT_DAYS)
      .toISOString()
      .slice(0, 10);

    const [openRes, oldestRes, staleRes] = await Promise.all([
      supabase.from("problem_tickets").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
      // Oldest-first so the first row is the one to name on the page.
      supabase
        .from("problem_tickets")
        .select("client_name, ticket_date")
        .eq("status", "in_progress")
        .order("ticket_date", { ascending: true })
        .limit(1),
      supabase
        .from("problem_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", "in_progress")
        .lt("ticket_date", alertCutoff),
    ]);

    if (openRes.error) throw new Error(openRes.error.message);
    if (oldestRes.error) throw new Error(oldestRes.error.message);
    if (staleRes.error) throw new Error(staleRes.error.message);

    const row = oldestRes.data?.[0] ?? null;
    const todayStart = startOfDayInTimeZone(new Date(), BUSINESS_TIMEZONE, 0).getTime();

    return ok({
      open: openRes.count ?? 0,
      overAlertAge: staleRes.count ?? 0,
      oldest: row
        ? {
            client_name: row.client_name,
            ticket_date: row.ticket_date,
            // ticket_date is a bare calendar date; anchor it at Toronto midnight.
            ageDays: Math.max(
              0,
              Math.round((todayStart - new Date(row.ticket_date + "T00:00:00").getTime()) / 86400000)
            ),
          }
        : null,
      alertDays: STALE_TICKET_ALERT_DAYS,
    });
  } catch (err) {
    return fail(err, "Could not read problem tickets.");
  }
}

// ─── Follow-ups ──────────────────────────────────────────────────────────────

export interface FollowupStats {
  dueToday: number;
  overdue: number;
}

export async function getFollowupStats(): Promise<Result<FollowupStats>> {
  try {
    const supabase = getSupabase();
    const now = new Date();
    const today = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 0).toISOString();
    const tomorrow = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 1).toISOString();

    // Same predicates the Follow-up page uses, so the numbers agree.
    const openLeads = () =>
      supabase
        .from("followup_leads")
        .select("id", { count: "exact", head: true })
        .is("closed_at", null)
        .not("next_followup_at", "is", null);

    const [dueRes, overdueRes] = await Promise.all([
      openLeads().gte("next_followup_at", today).lt("next_followup_at", tomorrow),
      openLeads().lt("next_followup_at", today),
    ]);

    if (dueRes.error) throw new Error(dueRes.error.message);
    if (overdueRes.error) throw new Error(overdueRes.error.message);

    return ok({ dueToday: dueRes.count ?? 0, overdue: overdueRes.count ?? 0 });
  } catch (err) {
    return fail(err, "Could not read follow-up leads.");
  }
}

// ─── Automations ─────────────────────────────────────────────────────────────

export interface AutomationHealth {
  /** True when migration 061 hasn't been applied — no history to report yet. */
  tableMissing: boolean;
  failing: { slug: string; label: string; run: CronRun }[];
  /** Jobs that ran before but haven't since their schedule says they should have. */
  silent: { slug: string; label: string; lastRun: string }[];
  /**
   * Jobs with no recorded run at all. NOT an alert: the history table only
   * started filling when 061 was applied, so every job looks like this until
   * its next scheduled firing — and a weekly job would raise a false alarm
   * for six days. "Never ran" and "stopped running" are different claims and
   * only the second one is evidence of a problem.
   */
  neverRun: { slug: string; label: string }[];
  lastRunAt: string | null;
  total: number;
}

// Longest gap tolerated before a job counts as silent. Daily jobs get two
// days, weekly ones eight — enough slack that one missed firing shows up
// without a late run crying wolf.
function toleranceMs(cron: string): number {
  const dayOfWeek = cron.trim().split(/\s+/)[4] ?? "*";
  const isWeekly = dayOfWeek !== "*" && !dayOfWeek.includes("-");
  return (isWeekly ? 8 : 2) * 24 * 60 * 60 * 1000;
}

export async function getAutomationHealth(): Promise<Result<AutomationHealth>> {
  try {
    const { runs, tableMissing } = await getLatestCronRuns(AUTOMATION_JOBS.map((j) => j.slug));
    if (tableMissing) {
      return ok({
        tableMissing: true,
        failing: [],
        silent: [],
        neverRun: [],
        lastRunAt: null,
        total: AUTOMATION_JOBS.length,
      });
    }

    const now = Date.now();
    const failing: AutomationHealth["failing"] = [];
    const silent: AutomationHealth["silent"] = [];
    const neverRun: AutomationHealth["neverRun"] = [];
    let lastRunAt: string | null = null;

    for (const job of AUTOMATION_JOBS) {
      const run = runs[job.slug];
      if (!run) {
        neverRun.push({ slug: job.slug, label: job.label });
        continue;
      }
      if (!lastRunAt || run.started_at > lastRunAt) lastRunAt = run.started_at;
      if (run.status === "error") {
        failing.push({ slug: job.slug, label: job.label, run });
      } else if (now - new Date(run.started_at).getTime() > toleranceMs(job.cron)) {
        silent.push({ slug: job.slug, label: job.label, lastRun: run.started_at });
      }
    }

    return ok({ tableMissing: false, failing, silent, neverRun, lastRunAt, total: AUTOMATION_JOBS.length });
  } catch (err) {
    return fail(err, "Could not read automation history.");
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface HomeDashboard {
  sales: Result<SalesToday & { cachedAt: string | null }>;
  tickets: Result<TicketStats>;
  followups: Result<FollowupStats>;
  automations: Result<AutomationHealth>;
}

export async function getHomeDashboard(): Promise<HomeDashboard> {
  const [sales, tickets, followups, automations] = await Promise.all([
    getSalesToday(),
    getTicketStats(),
    getFollowupStats(),
    getAutomationHealth(),
  ]);
  return { sales, tickets, followups, automations };
}
