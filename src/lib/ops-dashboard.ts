import { getSupabase } from "@/lib/supabase";
import {
  getStores,
  fetchAllPages,
  calcNetRevenue,
  REVENUE_FIELDS,
  type RevenueFields,
} from "@/lib/shopify";
import { cached } from "@/lib/api-cache";
import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";
import { computeMetrics, deduplicateRecords, type CallRecord } from "@/lib/call-metrics";
import { getPurchasingSummary, listProductsWithMetrics } from "@/lib/purchasing/queries";
import { getSalesTargets } from "@/lib/settings";
import { type Result } from "@/lib/home-dashboard";

// Data behind the operations dashboard. Same contract as home-dashboard.ts:
// every getter resolves to a value OR an error string and never throws, so one
// unreachable source greys a single card instead of blanking a screen the
// whole team is looking at.
//
// A failed source must never contribute a false zero or a false all-clear —
// that is the difference between "nothing sold today" and "we couldn't ask".

export type { Result } from "@/lib/home-dashboard";

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail(err: unknown, fallback: string): Result<never> {
  return { ok: false, error: err instanceof Error ? err.message : fallback };
}

// Shopify is the slow source; the rest are cheap Supabase reads.
const SALES_TTL_MS = 5 * 60 * 1000;

// ─── Toronto day helpers ─────────────────────────────────────────────────────

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

/** Toronto calendar day (YYYY-MM-DD) an instant falls on. */
export function businessDayKey(iso: string): string {
  return DAY_FORMAT.format(new Date(iso));
}

/** Minutes since Toronto midnight — how far into the business day we are. */
function minutesIntoDay(date: Date): number {
  const [h, m] = TIME_FORMAT.format(date).split(":");
  return Number(h) * 60 + Number(m);
}

/** The last `count` Toronto day keys, oldest first, ending today. */
function recentDayKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(businessDayKey(startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -i).toISOString()));
  }
  return keys;
}

// ─── Sales by store ──────────────────────────────────────────────────────────

export interface StoreSales {
  id: string;
  label: string;
  /** Short code for the pill: GRS / RF / BC. */
  code: string;
  todayRevenue: number;
  todayOrders: number;
  /** Mean revenue booked by this hour over the prior 7 days. Null with no history. */
  priorAverageToHour: number | null;
  last7: number;
  /** The 7 days before those, for the delta beneath the 7-day total. */
  previous7: number;
  last30: number;
  previous30: number;
  /** 14 daily revenue values, oldest first, for the sparkline. */
  sparkline: number[];
  /** Monthly target from settings, or null when none is set. */
  target: number | null;
  truncated: boolean;
}

export interface SalesByStore {
  stores: StoreSales[];
  failedStores: string[];
  cachedAt: string | null;
}

const ORDERS_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 250, after: $after, query: $filter) {
      edges {
        node {
          createdAt
          cancelledAt
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
  cancelledAt: string | null;
}

/**
 * A store's short code. The labels are configured per environment, so derive
 * from the id rather than parsing a label that someone may rename.
 */
const STORE_CODES: Record<string, string> = {
  store1: "RF",
  store2: "GRS",
  store3: "BC",
};

async function computeSalesByStore(): Promise<SalesByStore> {
  const now = new Date();
  const todayKey = businessDayKey(now.toISOString());
  const cutoffMinutes = minutesIntoDay(now);
  // 60 days back covers last-30 plus its previous-30 comparison in one pull.
  const windowStart = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -60);
  const filter = `created_at:>='${windowStart.toISOString()}'`;

  const configured = getStores();
  const failedStores: string[] = [];

  const results = await Promise.allSettled(
    configured.map((store) =>
      fetchAllPages<
        DatedOrder,
        { orders: { edges: { node: DatedOrder; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }
      >({
        storeId: store.id,
        query: ORDERS_QUERY,
        variables: { filter },
        getConnection: (data) => data.orders,
        maxPages: 40,
      })
    )
  );

  const last7Keys = new Set(recentDayKeys(now, 7));
  // The 7 complete days BEFORE today (-7..-1) — the baseline for "vs 7d".
  // last7Keys includes today, so using it here left only 6 accumulating days
  // divided by 7, understating the prior average ~14% and flattering today.
  const prior7Keys = new Set(
    recentDayKeys(startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -1), 7)
  );
  const prev7Keys = new Set(
    recentDayKeys(startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -7), 7)
  );
  const last30Keys = new Set(recentDayKeys(now, 30));
  const prev30Keys = new Set(
    recentDayKeys(startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30), 30)
  );
  const sparkKeys = recentDayKeys(now, 14);

  const stores: StoreSales[] = [];

  results.forEach((result, i) => {
    const config = configured[i];
    if (result.status === "rejected") {
      failedStores.push(config.label);
      return;
    }

    const byDay = new Map<string, number>();
    let todayRevenue = 0;
    let todayOrders = 0;
    let priorToHourTotal = 0;
    let priorToHourDays = 0;
    let last7 = 0;
    let previous7 = 0;
    let last30 = 0;
    let previous30 = 0;
    const priorDaysSeen = new Set<string>();

    for (const order of result.value.nodes) {
      // A cancelled order is not revenue. Refunds are already handled by
      // calcNetRevenue via the current subtotal.
      if (order.cancelledAt) continue;

      const key = businessDayKey(order.createdAt);
      const revenue = calcNetRevenue(order);
      byDay.set(key, (byDay.get(key) ?? 0) + revenue);

      if (key === todayKey) {
        todayRevenue += revenue;
        todayOrders += 1;
      } else if (minutesIntoDay(new Date(order.createdAt)) <= cutoffMinutes && prior7Keys.has(key)) {
        // Prior days clipped to the current hour, so a half-finished day is
        // never compared against full ones.
        priorToHourTotal += revenue;
        priorDaysSeen.add(key);
      }

      if (last7Keys.has(key)) last7 += revenue;
      else if (prev7Keys.has(key)) previous7 += revenue;
      if (last30Keys.has(key)) last30 += revenue;
      else if (prev30Keys.has(key)) previous30 += revenue;
    }

    // Divide by the whole window rather than only days that saw an order — a
    // zero-sale day is real and belongs in the average.
    priorToHourDays = 7;

    stores.push({
      id: config.id,
      label: config.label,
      code: STORE_CODES[config.id] ?? config.label.slice(0, 3).toUpperCase(),
      todayRevenue,
      todayOrders,
      priorAverageToHour: priorDaysSeen.size > 0 ? priorToHourTotal / priorToHourDays : null,
      last7,
      previous7,
      last30,
      previous30,
      sparkline: sparkKeys.map((k) => byDay.get(k) ?? 0),
      // Filled in by getSalesByStore after the cache — see the note there.
      target: null,
      truncated: result.value.truncated,
    });
  });

  return { stores, failedStores, cachedAt: null };
}

export async function getSalesByStore(): Promise<Result<SalesByStore>> {
  try {
    if (getStores().length === 0) {
      return { ok: false, error: "No Shopify stores are configured." };
    }
    // Day-keyed so the first request after midnight can't serve yesterday's
    // totals as today's.
    const dayKey = businessDayKey(new Date().toISOString());
    const [{ data, cachedAt }, targets] = await Promise.all([
      cached(`ops:sales:${dayKey}`, SALES_TTL_MS, computeSalesByStore),
      // Read OUTSIDE the cache and merged in here. Targets are one cheap
      // settings row, and burying them in the 5-minute Shopify cache meant
      // editing a target appeared to do nothing until the cache expired.
      getSalesTargets(),
    ]);
    return ok({
      ...data,
      stores: data.stores.map((s) => ({ ...s, target: targets[s.id] ?? null })),
      cachedAt,
    });
  } catch (err) {
    return fail(err, "Could not reach Shopify.");
  }
}

// ─── Warehouse & logistics ───────────────────────────────────────────────────

export interface WarehouseOutput {
  boxesBuilt: number;
  ordersPacked: number;
  walkinPickup: number;
}

export interface WarehouseOps {
  today: WarehouseOutput;
  last7: WarehouseOutput;
  last30: WarehouseOutput;
  inventoryValue: number;
  unitsOnHand: number;
  openPoValue: number;
  /** Open purchase orders and how far off the soonest arrival is. */
  openPoCount: number;
  daysUntilNextArrival: number | null;
  /** Glass SKUs flagged reorder / reorder_plus_montreal. */
  reorderSkus: number;
  reorderUnits: number;
  montrealTransfers: number;
  /** Unfulfilled Shopify orders across every store. */
  unfulfilled: number;
  oldestUnfulfilledDays: number | null;
  /** Mean hours from order to first fulfillment over the last 30 days. */
  avgFulfillmentHours: number | null;
}

const EMPTY_OUTPUT: WarehouseOutput = { boxesBuilt: 0, ordersPacked: 0, walkinPickup: 0 };

function sumOutput(
  rows: { report_date: string; boxes_built: number; orders_packed: number; walkin_pickup: number }[],
  within: Set<string>
): WarehouseOutput {
  return rows.reduce<WarehouseOutput>(
    (acc, r) =>
      within.has(r.report_date)
        ? {
            boxesBuilt: acc.boxesBuilt + (r.boxes_built ?? 0),
            ordersPacked: acc.ordersPacked + (r.orders_packed ?? 0),
            walkinPickup: acc.walkinPickup + (r.walkin_pickup ?? 0),
          }
        : acc,
    { ...EMPTY_OUTPUT }
  );
}

const UNFULFILLED_QUERY = `
  query($after: String) {
    orders(first: 250, after: $after, sortKey: CREATED_AT, query: "fulfillment_status:unfulfilled") {
      edges { node { createdAt } cursor }
      pageInfo { hasNextPage }
    }
  }
`;

const FULFILLED_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 250, after: $after, query: $filter) {
      edges { node { createdAt fulfillments(first: 1) { createdAt } } cursor }
      pageInfo { hasNextPage }
    }
  }
`;

interface FulfilledOrder {
  createdAt: string;
  fulfillments: { createdAt: string }[];
}

/** Backlog across every store, plus how long shipping currently takes. */
async function getFulfillmentPicture(since: Date) {
  const stores = getStores();
  const [unfulfilledResults, fulfilledResults] = await Promise.all([
    Promise.allSettled(
      stores.map((s) =>
        fetchAllPages<{ createdAt: string }, { orders: { edges: { node: { createdAt: string }; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(
          { storeId: s.id, query: UNFULFILLED_QUERY, getConnection: (d) => d.orders, maxPages: 20 }
        )
      )
    ),
    Promise.allSettled(
      stores.map((s) =>
        fetchAllPages<FulfilledOrder, { orders: { edges: { node: FulfilledOrder; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(
          {
            storeId: s.id,
            query: FULFILLED_QUERY,
            variables: { filter: `created_at:>='${since.toISOString()}' AND fulfillment_status:fulfilled` },
            getConnection: (d) => d.orders,
            maxPages: 20,
          }
        )
      )
    ),
  ]);

  const openOrders = unfulfilledResults.flatMap((r) => (r.status === "fulfilled" ? r.value.nodes : []));
  const oldest = openOrders.reduce<string | null>(
    (min, o) => (min === null || o.createdAt < min ? o.createdAt : min),
    null
  );

  let hoursTotal = 0;
  let hoursCount = 0;
  for (const r of fulfilledResults) {
    if (r.status !== "fulfilled") continue;
    for (const o of r.value.nodes) {
      const first = o.fulfillments?.[0]?.createdAt;
      if (!first) continue;
      const hours = (new Date(first).getTime() - new Date(o.createdAt).getTime()) / 3_600_000;
      if (hours >= 0) {
        hoursTotal += hours;
        hoursCount += 1;
      }
    }
  }

  return {
    unfulfilled: openOrders.length,
    oldestUnfulfilledDays: oldest
      ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000)
      : null,
    avgFulfillmentHours: hoursCount > 0 ? Math.round((hoursTotal / hoursCount) * 10) / 10 : null,
  };
}

// Everything below sales is also served through cached(): the wall board
// polls every 90 seconds all day, and without a cache every poll re-pulled
// Shopify (~15 paginated queries). Day-keyed like sales so the first request
// after midnight can't serve yesterday's numbers as today's; only successful
// computes are cached, so a failing source keeps degrading rather than
// pinning a stale success.
const OPS_TTL_MS = 5 * 60 * 1000;

export async function getWarehouseOps(): Promise<Result<WarehouseOps>> {
  try {
    const dayKey = businessDayKey(new Date().toISOString());
    const { data } = await cached(`ops:warehouse:${dayKey}`, OPS_TTL_MS, computeWarehouseOps);
    return ok(data);
  } catch (err) {
    return fail(err, "Could not read warehouse data.");
  }
}

async function computeWarehouseOps(): Promise<WarehouseOps> {
  {
    const now = new Date();
    const since = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30).toISOString().slice(0, 10);

    type ReportRow = {
      report_date: string;
      boxes_built: number;
      orders_packed: number;
      walkin_pickup: number;
    };

    const [rows, summary, products, openPos, fulfillment] = await Promise.all([
      // Paged for the same reason the call query is — one row per employee
      // per day stays well under 1000 today, but a silent truncation here
      // would quietly under-report the team's output rather than error.
      fetchAllRows<ReportRow>((from, to) =>
        getSupabase()
          .from("warehouse_daily_reports")
          .select("report_date, boxes_built, orders_packed, walkin_pickup")
          .gte("report_date", since)
          .order("report_date", { ascending: true })
          .range(from, to)
      ),
      getPurchasingSummary(),
      listProductsWithMetrics(),
      getSupabase()
        .from("purchasing_orders")
        .select("id")
        .in("status", ["ordered", "in_transit"]),
      getFulfillmentPicture(startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30)),
    ]);

    // A day with no report contributes nothing — never estimate a missing day.
    const todayKeys = new Set(recentDayKeys(now, 1));
    const last7Keys = new Set(recentDayKeys(now, 7));
    const last30Keys = new Set(recentDayKeys(now, 30));

    const glassReorder = products.filter(
      (p) =>
        p.category === "glass" &&
        (p.sop_label === "reorder" || p.sop_label === "reorder_plus_montreal")
    );

    return {
      today: sumOutput(rows, todayKeys),
      last7: sumOutput(rows, last7Keys),
      last30: sumOutput(rows, last30Keys),
      inventoryValue: summary.total_inventory_value,
      unitsOnHand: summary.units_on_hand,
      openPoValue: summary.open_po_value,
      openPoCount: openPos.data?.length ?? 0,
      // Soonest arrival across everything on order. Products with no inbound
      // PO report null and are ignored rather than counted as "arriving today".
      daysUntilNextArrival:
        products
          .map((p) => p.days_until_next_arrival)
          .filter((d): d is number => typeof d === "number" && d >= 0)
          .sort((a, b) => a - b)[0] ?? null,
      ...fulfillment,
      reorderSkus: glassReorder.length,
      reorderUnits: glassReorder.reduce((sum, p) => sum + (p.suggested_qty ?? 0), 0),
      montrealTransfers: products.filter(
        (p) => p.sop_label === "montreal_transfer" || p.sop_label === "reorder_plus_montreal"
      ).length,
    };
  }
}

// ─── Customer service ────────────────────────────────────────────────────────

export interface CallWindow {
  missRate: number | null;
  callbackRate: number | null;
  avgResponseTime: number | null;
  inbound: number;
}

export interface CustomerServiceOps {
  yesterday: CallWindow;
  last7: CallWindow;
  last30: CallWindow;
  quotes: QuoteWindows;
}

export interface QuoteWindows {
  yesterday: number;
  last7: number;
  last30: number;
  /** Net value of the last 30 days' quotes. */
  quotedValue30: number;
  /** COMPLETED ÷ total over the last 30 days, as a percentage. */
  conversion30: number | null;
}

const DRAFTS_QUERY = `
  query($after: String, $filter: String!) {
    draftOrders(first: 250, after: $after, query: $filter) {
      edges { node { createdAt status ${REVENUE_FIELDS} } cursor }
      pageInfo { hasNextPage }
    }
  }
`;

interface DraftRow extends RevenueFields {
  createdAt: string;
  status: string;
}

/**
 * Quotes = draft orders, excluding status OPEN. An OPEN draft is a work in
 * progress rather than a quote that went out, and /api/kpi/metrics applies the
 * same exclusion — the two pages must not disagree about what counts.
 */
async function getQuoteWindows(now: Date): Promise<QuoteWindows> {
  const start30 = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30);
  const startYesterday = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -1).toISOString();
  const startToday = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 0).toISOString();
  const start7 = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -7).toISOString();
  const filter = `created_at:>='${start30.toISOString()}'`;

  const results = await Promise.allSettled(
    getStores().map((s) =>
      fetchAllPages<DraftRow, { draftOrders: { edges: { node: DraftRow; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(
        { storeId: s.id, query: DRAFTS_QUERY, variables: { filter }, getConnection: (d) => d.draftOrders, maxPages: 40 }
      )
    )
  );

  const drafts = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value.nodes : []))
    .filter((d) => d.status !== "OPEN");

  const completed = drafts.filter((d) => d.status === "COMPLETED").length;

  return {
    yesterday: drafts.filter((d) => d.createdAt >= startYesterday && d.createdAt < startToday).length,
    last7: drafts.filter((d) => d.createdAt >= start7).length,
    last30: drafts.length,
    quotedValue30: drafts.reduce((sum, d) => sum + calcNetRevenue(d), 0),
    conversion30: drafts.length > 0 ? (completed / drafts.length) * 100 : null,
  };
}

/** NaN and Infinity reach the page as "—", never as a number. */
function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Records must already be deduplicated PER STORE before they reach here.
 * Deduping the cross-store union isn't the same operation — the CIK/
 * Grasshopper matching is only meaningful within one store's phone system,
 * and it's how the Phones page runs, so the two must agree.
 */
function windowFrom(deduped: CallRecord[]): CallWindow {
  const inbound = deduped.filter((r) => r.direction === "inbound").length;

  // The miss rate is defined over WEEKDAY inbound calls only, and
  // computeMetrics returns 0 — not null — when there are none. So a Sunday
  // with a few weekend calls sailed past a total-inbound guard and rendered
  // as a perfect green 0.0%, when the honest answer is "nothing to measure".
  const weekdayInbound = deduped.filter((r) => {
    if (r.direction !== "inbound") return false;
    const day = new Date(r.call_start).getDay();
    return day !== 0 && day !== 6;
  }).length;
  if (weekdayInbound === 0) {
    return { missRate: null, callbackRate: null, avgResponseTime: null, inbound };
  }

  const metrics = computeMetrics(deduped);
  return {
    missRate: finiteOrNull(metrics.miss_rate),
    callbackRate: finiteOrNull(metrics.outbound_callback_rate),
    avgResponseTime: finiteOrNull(metrics.avg_response_time),
    inbound,
  };
}

/**
 * Read every matching row, not the first page.
 *
 * PostgREST caps a response at 1000 rows and does so SILENTLY — `.limit(20000)`
 * returns 1000 with no error and no flag. That produced a 0% miss rate for the
 * last 7 days here, because the only rows fetched were the oldest ones in the
 * window. Any table that can exceed 1000 rows in the queried range has to be
 * paged.
 */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxPages = 50
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function getCustomerServiceOps(): Promise<Result<CustomerServiceOps>> {
  try {
    const dayKey = businessDayKey(new Date().toISOString());
    const { data } = await cached(`ops:cs:${dayKey}`, OPS_TTL_MS, computeCustomerServiceOps);
    return ok(data);
  } catch (err) {
    return fail(err, "Could not read call records.");
  }
}

async function computeCustomerServiceOps(): Promise<CustomerServiceOps> {
  const now = new Date();
  const since = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30).toISOString();
  const yesterdayStart = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -1).toISOString();
  const todayStart = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 0).toISOString();
  const sevenStart = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -7).toISOString();

  const quotes = await getQuoteWindows(now);

  const raw = await fetchAllRows<CallRecord & { store_id: string | null }>((from, to) =>
    getSupabase()
      .from("call_records")
      .select("id, store_id, call_start, call_end, from_number, to_number, direction, duration_min, charge, endpoint, source")
      .gte("call_start", since)
      // id as tie-break: same-second calls at a page boundary would otherwise
      // have no deterministic order and could be skipped or doubled.
      .order("call_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  // Dedupe per store and only then merge — exactly the Phones page's
  // pipeline, so this card is that page's per-store numbers summed rather
  // than a third, slightly different truth. Deduping the union instead let
  // one store's Grasshopper rows eat another store's CIK rows.
  const byStore = new Map<string, CallRecord[]>();
  for (const r of raw) {
    const list = byStore.get(r.store_id ?? "unknown") ?? [];
    list.push(r);
    byStore.set(r.store_id ?? "unknown", list);
  }
  const all = [...byStore.values()].flatMap((records) => deduplicateRecords(records));

  return {
    yesterday: windowFrom(
      all.filter((r) => r.call_start >= yesterdayStart && r.call_start < todayStart)
    ),
    last7: windowFrom(all.filter((r) => r.call_start >= sevenStart)),
    last30: windowFrom(all),
    quotes,
  };
}

// ─── Top performers ──────────────────────────────────────────────────────────

export interface Performer {
  id: string;
  name: string;
  /** Headline value for the currently selected ranking metric. */
  value: number;
  /** Same metric over the previous 30 days, for the delta. Null when unknown. */
  previous: number | null;
  /** Everything the UI can rank by, so switching the dropdown needs no refetch. */
  metrics: Record<string, number>;
  meta: string;
}

export interface TopPerformers {
  sales: Performer[];
  warehouse: Performer[];
  customerService: Performer[];
}

interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  shopify_tags: string[] | null;
  locations: { shopify_store_ids: string[] | null } | null;
}

/**
 * Tags used to match an order to an employee: configured `shopify_tags` when
 * set, else name-derived. Mirrors getMatchTags in /api/kpi/metrics — attribution
 * must agree with the KPI page or the same person ranks differently in two
 * places.
 */
function matchTags(emp: { name: string; shopify_tags?: string[] | null }): string[] {
  const configured = (emp.shopify_tags ?? []).map((t) => t.toLowerCase()).filter(Boolean);
  if (configured.length > 0) return configured;
  const name = emp.name.trim().toLowerCase();
  return [...new Set([name, ...name.split(/\s+/)])];
}

const PERFORMER_ORDERS_QUERY = `
  query($after: String, $filter: String!) {
    orders(first: 250, after: $after, query: $filter) {
      edges {
        node { createdAt cancelledAt tags ${REVENUE_FIELDS} }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

const PERFORMER_DRAFTS_QUERY = `
  query($after: String, $filter: String!) {
    draftOrders(first: 250, after: $after, query: $filter) {
      edges {
        node { createdAt status tags ${REVENUE_FIELDS} }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface TaggedOrder extends RevenueFields {
  createdAt: string;
  cancelledAt: string | null;
  tags: string[];
}

interface TaggedDraft extends RevenueFields {
  createdAt: string;
  status: string;
  tags: string[];
}

export async function getTopPerformers(): Promise<Result<TopPerformers>> {
  try {
    const dayKey = businessDayKey(new Date().toISOString());
    const { data } = await cached(`ops:performers:${dayKey}`, OPS_TTL_MS, computeTopPerformers);
    return ok(data);
  } catch (err) {
    return fail(err, "Could not read performer data.");
  }
}

async function computeTopPerformers(): Promise<TopPerformers> {
  {
    const now = new Date();
    const start30 = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -30);
    const start60 = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, -60);
    const start30Iso = start30.toISOString();

    const { data: employeeData, error: employeeError } = await getSupabase()
      .from("employees")
      .select("id, name, department, shopify_tags, locations(shopify_store_ids)")
      .eq("active", true)
      .order("name");
    if (employeeError) throw new Error(employeeError.message);
    const employees = (employeeData ?? []) as unknown as EmployeeRow[];

    // One Shopify pull covering both 30-day windows, then attribute in memory.
    // Calling the per-employee helpers would re-download every order once per
    // person — fine for a report, far too slow for a dashboard.
    const filter = `created_at:>='${start60.toISOString()}'`;
    const stores = getStores();

    const [orderResults, draftResults, warehouseRows, followupLogs] = await Promise.all([
      Promise.allSettled(
        stores.map((s) =>
          fetchAllPages<TaggedOrder, { orders: { edges: { node: TaggedOrder; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(
            { storeId: s.id, query: PERFORMER_ORDERS_QUERY, variables: { filter }, getConnection: (d) => d.orders, maxPages: 40 }
          )
        )
      ),
      Promise.allSettled(
        stores.map((s) =>
          fetchAllPages<TaggedDraft, { draftOrders: { edges: { node: TaggedDraft; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(
            { storeId: s.id, query: PERFORMER_DRAFTS_QUERY, variables: { filter }, getConnection: (d) => d.draftOrders, maxPages: 40 }
          )
        )
      ),
      fetchAllRows<{ employee_id: string; report_date: string; boxes_built: number; orders_packed: number; walkin_pickup: number }>(
        (from, to) =>
          getSupabase()
            .from("warehouse_daily_reports")
            .select("employee_id, report_date, boxes_built, orders_packed, walkin_pickup")
            .gte("report_date", start60.toISOString().slice(0, 10))
            .order("report_date", { ascending: true })
            .range(from, to)
      ),
      fetchAllRows<{ logged_by: string; created_at: string }>((from, to) =>
        getSupabase()
          .from("followup_logs")
          .select("logged_by, created_at")
          .gte("created_at", start60.toISOString())
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
    ]);

    const orders = orderResults.flatMap((r) => (r.status === "fulfilled" ? r.value.nodes : []));
    const drafts = draftResults.flatMap((r) => (r.status === "fulfilled" ? r.value.nodes : []));

    const inCurrent = (iso: string) => iso >= start30Iso;

    // ── Sales: sold $, quoted $, conversion, by order/draft tag ──
    const salesPeople = employees.filter(
      (e) => (e.department ?? "").toLowerCase().includes("sales") || matchTags(e).length > 0
    );

    const sales: Performer[] = salesPeople
      .map((emp) => {
        const tags = matchTags(emp);
        const hit = (t: string[]) => t.some((x) => tags.includes(x.toLowerCase()));

        let sold = 0, soldPrev = 0, orderCount = 0;
        for (const o of orders) {
          if (o.cancelledAt || !hit(o.tags)) continue;
          const rev = calcNetRevenue(o);
          if (inCurrent(o.createdAt)) { sold += rev; orderCount++; } else soldPrev += rev;
        }

        let quoted = 0, total = 0, won = 0;
        for (const d of drafts) {
          // OPEN drafts are works in progress, excluded here exactly as
          // /api/kpi/metrics excludes them.
          if (d.status === "OPEN" || !hit(d.tags) || !inCurrent(d.createdAt)) continue;
          quoted += calcNetRevenue(d);
          total++;
          if (d.status === "COMPLETED") won++;
        }

        const conversion = total > 0 ? (won / total) * 100 : 0;
        return {
          id: emp.id,
          name: emp.name,
          value: sold,
          previous: soldPrev,
          metrics: { sold, quoted, conversion },
          meta: `${orderCount} order${orderCount === 1 ? "" : "s"} · ${conversion.toFixed(1)}% conv`,
        };
      })
      .filter((p) => p.metrics.sold > 0 || p.metrics.quoted > 0)
      .sort((a, b) => b.value - a.value);

    // ── Warehouse: units built/packed/walk-in ──
    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    const warehouseTotals = new Map<string, { cur: Record<string, number>; prevUnits: number }>();
    for (const row of warehouseRows) {
      const current = row.report_date >= start30Iso.slice(0, 10);
      const entry =
        warehouseTotals.get(row.employee_id) ??
        { cur: { boxes: 0, packed: 0, walkin: 0, units: 0 }, prevUnits: 0 };
      const units = (row.boxes_built ?? 0) + (row.orders_packed ?? 0) + (row.walkin_pickup ?? 0);
      if (current) {
        entry.cur.boxes += row.boxes_built ?? 0;
        entry.cur.packed += row.orders_packed ?? 0;
        entry.cur.walkin += row.walkin_pickup ?? 0;
        entry.cur.units += units;
      } else {
        entry.prevUnits += units;
      }
      warehouseTotals.set(row.employee_id, entry);
    }

    const warehouse: Performer[] = [...warehouseTotals.entries()]
      .filter(([id]) => nameById.has(id))
      .map(([id, v]) => ({
        id,
        name: nameById.get(id)!,
        value: v.cur.units,
        previous: v.prevUnits,
        metrics: v.cur,
        meta: `${v.cur.boxes} built · ${v.cur.packed} packed`,
      }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    // ── Customer service: follow-ups logged. Calls are deliberately absent —
    // the phone data has no per-agent attribution, and inventing one would be
    // worse than the gap.
    const followTotals = new Map<string, { cur: number; prev: number }>();
    for (const log of followupLogs) {
      const who = (log.logged_by || "").trim();
      if (!who || who === "admin") continue;
      const entry = followTotals.get(who) ?? { cur: 0, prev: 0 };
      if (inCurrent(log.created_at)) entry.cur += 1;
      else entry.prev += 1;
      followTotals.set(who, entry);
    }

    const customerService: Performer[] = [...followTotals.entries()]
      .map(([who, v]) => {
        const emp = employees.find(
          (e) => e.name.toLowerCase() === who.toLowerCase() || who.toLowerCase().startsWith(e.name.split(/\s+/)[0].toLowerCase())
        );
        return {
          id: emp?.id ?? who,
          name: emp?.name ?? who,
          value: v.cur,
          previous: v.prev,
          metrics: { followups: v.cur },
          meta: `${v.cur} follow-up${v.cur === 1 ? "" : "s"} logged`,
        };
      })
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value);

    return { sales, warehouse, customerService };
  }
}

// ─── Collection (RF store only) ──────────────────────────────────────────────

export interface CollectionOps {
  over30Count: number;
  over30Amount: number;
  over60Count: number;
  over60Amount: number;
  over90Count: number;
  totalUnpaid: number;
  unpaidCount: number;
  /** Days sales outstanding, for the card's header note. */
  dsoDays: number | null;
  oldest: { name: string; days: number; amount: number; order: string } | null;
}

interface UnpaidOrder {
  name?: string;
  customer?: string;
  daysPending?: number;
  amount?: number;
  total?: number;
  orderNumber?: string;
}

/**
 * Reads the existing accounting route's unpaid block rather than
 * re-implementing the Shopify query, so the dashboard and the Accounting page
 * can never disagree about what is outstanding.
 */
export interface OpsDashboard {
  sales: Result<SalesByStore>;
  warehouse: Result<WarehouseOps>;
  customerService: Result<CustomerServiceOps>;
  performers: Result<TopPerformers>;
  collection: Result<CollectionOps>;
}

/** Everything the dashboard needs, each source degrading on its own. */
export async function getOpsDashboard(baseUrl: string, cookie: string): Promise<OpsDashboard> {
  const [sales, warehouse, customerService, performers, collection] = await Promise.all([
    getSalesByStore(),
    getWarehouseOps(),
    getCustomerServiceOps(),
    getTopPerformers(),
    getCollectionOps(baseUrl, cookie),
  ]);
  return { sales, warehouse, customerService, performers, collection };
}

export async function getCollectionOps(baseUrl: string, cookie: string): Promise<Result<CollectionOps>> {
  try {
    // Cached shared, not per session — the figures are company-wide, and the
    // token-authed wall board (which has no cookie) then shows collection too
    // whenever any signed-in load has warmed the cache. A cold cache with no
    // cookie throws and is NOT cached, so the wall degrades instead of
    // pinning a failure.
    const dayKey = businessDayKey(new Date().toISOString());
    const { data } = await cached(`ops:collection:${dayKey}`, OPS_TTL_MS, () =>
      computeCollectionOps(baseUrl, cookie)
    );
    return ok(data);
  } catch (err) {
    return fail(err, "Could not read unpaid orders.");
  }
}

async function computeCollectionOps(baseUrl: string, cookie: string): Promise<CollectionOps> {
  {
    const res = await fetch(`${baseUrl}/api/shopify/accounting?storeId=store1`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Accounting API returned ${res.status}`);
    const json = await res.json();
    const unpaid = json?.unpaid ?? {};
    const orders: UnpaidOrder[] = Array.isArray(unpaid.orders) ? unpaid.orders : [];

    const amountOf = (o: UnpaidOrder) => o.amount ?? o.total ?? 0;
    const over30 = orders.filter((o) => (o.daysPending ?? 0) >= 30);
    const over60 = orders.filter((o) => (o.daysPending ?? 0) >= 60);
    const over90 = orders.filter((o) => (o.daysPending ?? 0) >= 90);
    const oldest = [...orders].sort((a, b) => (b.daysPending ?? 0) - (a.daysPending ?? 0))[0];

    return {
      over30Count: over30.length,
      over30Amount: over30.reduce((s, o) => s + amountOf(o), 0),
      over60Count: over60.length,
      over60Amount: over60.reduce((s, o) => s + amountOf(o), 0),
      over90Count: over90.length,
      totalUnpaid: unpaid.totalUnpaid ?? orders.reduce((s, o) => s + amountOf(o), 0),
      unpaidCount: unpaid.count ?? orders.length,
      // Keep a decimal: most Shopify orders are paid at checkout, so the mean
      // is well under a day and rounding to an integer renders a true "0.4"
      // as a "0" that reads like a broken tile.
      dsoDays:
        typeof json?.dso?.avgDays === "number"
          ? Math.round(json.dso.avgDays * 10) / 10
          : null,
      oldest: oldest
        ? {
            name: oldest.customer ?? oldest.name ?? "Unknown",
            days: oldest.daysPending ?? 0,
            amount: amountOf(oldest),
            order: oldest.orderNumber ?? oldest.name ?? "",
          }
        : null,
    };
  }
}
