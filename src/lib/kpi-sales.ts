import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";
import { OrdersResponseSchema, DraftOrdersResponseSchema } from "@/lib/schemas";

// --------------- Types ---------------

interface OrderNode extends RevenueFields {
  id: string;
  createdAt: string;
  tags: string[];
  staffMember?: { firstName: string; lastName: string } | null;
  cancelledAt?: string | null;
  currentSubtotalPriceSet?: { shopMoney: { amount: string } };
}

interface OrdersResponse {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

interface DraftOrderNode extends RevenueFields {
  id: string;
  name: string;
  createdAt: string;
  status: string; // OPEN, INVOICE_SENT, COMPLETED
  tags: string[];
  order: { id: string; createdAt: string } | null;
}

interface DraftOrdersResponse {
  draftOrders: {
    edges: { node: DraftOrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

export interface SalesMetrics {
  revenue: number;
  orders: number;
  aov: number;
}

export interface DraftMetrics {
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  invoiceSentDrafts: number;
  conversionRate: number; // 0-100
  totalQuotedAmount: number;
  wonAmount: number;
  drafts: DraftOrderSummary[];
}

export interface DraftOrderSummary {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  amount: number;
  hasOrder: boolean;
}

/**
 * Net revenue for an order, using post-refund subtotal when available.
 * Uses currentSubtotalPriceSet (subtotal after refund adjustments) if present,
 * otherwise falls back to subtotalPriceSet (original subtotal).
 */
function calcOrderNetRevenue(order: OrderNode): number {
  const subtotal = parseFloat(
    order.currentSubtotalPriceSet?.shopMoney.amount
    ?? order.subtotalPriceSet.shopMoney.amount
  );
  const shippingCost = parseFloat(order.shippingCostMeta?.value ?? "0") || 0;
  const exportTariff = parseFloat(order.exportTariffMeta?.value ?? "0") || 0;
  return subtotal - shippingCost - exportTariff;
}

// --------------- Queries ---------------

function makeOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node { id createdAt tags cancelledAt staffMember { firstName lastName } currentSubtotalPriceSet { shopMoney { amount } } ${REVENUE_FIELDS} }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

function makeDraftOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      draftOrders(first: 250, sortKey: ID, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node {
            id name createdAt status
            ${REVENUE_FIELDS}
            tags
            order { id createdAt }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

// --------------- Data Fetching ---------------

const MAX_PAGES = 80; // 80 pages × 250 per page = 20,000 records max per store

/** Tracks partial failures so the API can surface warnings to the UI. */
export interface FetchWarning {
  storeId: string;
  type: "orders" | "drafts";
  message: string;
}

interface FetchResult<T> {
  data: T[];
  warnings: FetchWarning[];
}

async function fetchAllOrders(
  storeIds: string[],
  fromDate: string
): Promise<FetchResult<OrderNode>> {
  const stores = getStores();
  const allOrders: OrderNode[] = [];
  const warnings: FetchWarning[] = [];

  for (const store of stores) {
    if (!storeIds.includes(store.id)) continue;
    try {
      let cursor: string | undefined;
      let hasNext = true;
      let pages = 0;
      while (hasNext && pages < MAX_PAGES) {
        const raw = await shopifyGraphQL(
          store.id,
          makeOrdersQuery(fromDate, cursor)
        );
        const data = OrdersResponseSchema.parse(raw);
        const edges = data.orders.edges;
        allOrders.push(...edges.map((e) => e.node as unknown as OrderNode));
        hasNext = data.orders.pageInfo.hasNextPage;
        cursor = edges[edges.length - 1]?.cursor;
        pages++;
      }
      if (pages >= MAX_PAGES) {
        warnings.push({ storeId: store.id, type: "orders", message: `Hit ${MAX_PAGES}-page limit — results may be incomplete` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kpi-sales] Order fetch failed for ${store.id}:`, err);
      warnings.push({ storeId: store.id, type: "orders", message: `Failed to fetch orders: ${msg}` });
    }
  }

  return { data: allOrders, warnings };
}

async function fetchAllDraftOrders(
  storeIds: string[],
  fromDate: string
): Promise<FetchResult<DraftOrderNode>> {
  const stores = getStores();
  const allDrafts: DraftOrderNode[] = [];
  const warnings: FetchWarning[] = [];

  for (const store of stores) {
    if (!storeIds.includes(store.id)) continue;
    try {
      let cursor: string | undefined;
      let hasNext = true;
      let pages = 0;
      while (hasNext && pages < MAX_PAGES) {
        const raw = await shopifyGraphQL(
          store.id,
          makeDraftOrdersQuery(fromDate, cursor)
        );
        const data = DraftOrdersResponseSchema.parse(raw);
        const edges = data.draftOrders.edges;
        allDrafts.push(...edges.map((e) => e.node as unknown as DraftOrderNode));
        hasNext = data.draftOrders.pageInfo.hasNextPage;
        cursor = edges[edges.length - 1]?.cursor;
        pages++;
      }
      if (pages >= MAX_PAGES) {
        warnings.push({ storeId: store.id, type: "drafts", message: `Hit ${MAX_PAGES}-page limit — results may be incomplete` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kpi-sales] Draft fetch FAILED for ${store.id}:`, msg);
      warnings.push({ storeId: store.id, type: "drafts", message: `Failed to fetch drafts: ${msg}` });
    }
  }

  return { data: allDrafts, warnings };
}

// --------------- Metrics Calculation ---------------

/**
 * Calculate sales metrics for an employee in a date range.
 * Uses Shopify order tags to attribute orders.
 */
export async function getEmployeeSalesMetrics(
  employeeTags: string[],
  storeIds: string[],
  startDate: Date,
  endDate: Date
): Promise<SalesMetrics> {
  const lowerTags = employeeTags.map((t) => t.toLowerCase()).filter(Boolean);
  if (lowerTags.length === 0) return { revenue: 0, orders: 0, aov: 0 };

  const { data: allOrders } = await fetchAllOrders(storeIds, toDateStr(startDate));

  let revenue = 0;
  let orderCount = 0;

  for (const order of allOrders) {
    if (order.cancelledAt) continue; // skip cancelled orders
    const orderDate = new Date(order.createdAt);
    if (orderDate < startDate || orderDate >= endDate) continue;

    const orderTags = order.tags.map((t) => t.toLowerCase());
    if (!lowerTags.some((et) => orderTags.includes(et))) continue;

    revenue += calcOrderNetRevenue(order);
    orderCount++;
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    orders: orderCount,
    aov: orderCount > 0 ? Math.round((revenue / orderCount) * 100) / 100 : 0,
  };
}

/**
 * Calculate draft order (quote) metrics for an employee in a date range.
 */
export async function getEmployeeDraftMetrics(
  employeeTags: string[],
  storeIds: string[],
  startDate: Date,
  endDate: Date
): Promise<DraftMetrics> {
  const lowerTags = employeeTags.map((t) => t.toLowerCase()).filter(Boolean);
  if (lowerTags.length === 0)
    return {
      totalDrafts: 0,
      completedDrafts: 0,
      openDrafts: 0,
      invoiceSentDrafts: 0,
      conversionRate: 0,
      totalQuotedAmount: 0,
      wonAmount: 0,
      drafts: [],
    };

  const { data: allDrafts } = await fetchAllDraftOrders(storeIds, toDateStr(startDate));

  const matchedDrafts: DraftOrderSummary[] = [];
  let completedCount = 0;
  let invoiceSentCount = 0;
  let totalQuoted = 0;
  let wonAmount = 0;

  for (const draft of allDrafts) {
    const draftDate = new Date(draft.createdAt);
    if (draftDate < startDate || draftDate >= endDate) continue;

    const draftTags = draft.tags.map((t) => t.toLowerCase());
    if (!lowerTags.some((et) => draftTags.includes(et))) continue;

    const amount = calcNetRevenue(draft);

    totalQuoted += amount;
    if (draft.status === "COMPLETED") {
      completedCount++;
      wonAmount += amount;
    } else if (draft.status === "INVOICE_SENT") {
      invoiceSentCount++;
    }

    matchedDrafts.push({
      id: draft.id,
      name: draft.name,
      createdAt: draft.createdAt,
      status: draft.status,
      amount: Math.round(amount * 100) / 100,
      hasOrder: !!draft.order,
    });
  }

  const total = matchedDrafts.length;
  const openCount = total - completedCount - invoiceSentCount;

  return {
    totalDrafts: total,
    completedDrafts: completedCount,
    openDrafts: openCount,
    invoiceSentDrafts: invoiceSentCount,
    conversionRate: total > 0 ? Math.round((completedCount / total) * 1000) / 10 : 0,
    totalQuotedAmount: Math.round(totalQuoted * 100) / 100,
    wonAmount: Math.round(wonAmount * 100) / 100,
    drafts: matchedDrafts.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
  };
}

/**
 * Get monthly conversion data for the past N months (for chart).
 */
export async function getMonthlyConversionHistory(
  employeeTags: string[],
  storeIds: string[],
  months: number = 12
): Promise<{ month: string; totalDrafts: number; completedDrafts: number; conversionRate: number }[]> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const lowerTags = employeeTags.map((t) => t.toLowerCase()).filter(Boolean);
  if (lowerTags.length === 0) return [];

  const { data: allDrafts } = await fetchAllDraftOrders(storeIds, toDateStr(startDate));

  // Group by month
  const monthMap = new Map<string, { total: number; completed: number }>();

  // Initialize all months
  for (let i = 0; i < months; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { total: 0, completed: 0 });
  }

  for (const draft of allDrafts) {
    const draftDate = new Date(draft.createdAt);
    if (draftDate < startDate || draftDate >= endDate) continue;

    const draftTags = draft.tags.map((t) => t.toLowerCase());
    if (!lowerTags.some((et) => draftTags.includes(et))) continue;

    const key = `${draftDate.getFullYear()}-${String(draftDate.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key);
    if (entry) {
      entry.total++;
      if (draft.status === "COMPLETED") entry.completed++;
    }
  }

  return [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      totalDrafts: data.total,
      completedDrafts: data.completed,
      conversionRate:
        data.total > 0
          ? Math.round((data.completed / data.total) * 1000) / 10
          : 0,
    }));
}

// --------------- Pipeline Metrics ---------------

export interface PipelineMetrics {
  totalQuotedValue: number;
  wonRevenue: number;
  conversionRate: number;
  valueWinRate: number;
  avgCycleTimeDays: number;
  pipelineValue: number;
  avgSaleValue: number;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  invoiceSentDrafts: number;
  predictedRevenue: number;
  predictedTimelineDays: number;
  monthlyTrend: {
    month: string;
    draftsCreated: number;
    draftsConverted: number;
    conversionRate: number;
    pipelineValue: number;
    revenue: number;
  }[];
}

export interface RepPipelineEntry {
  repTag: string;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  conversionRate: number;
  totalQuoted: number;
  wonRevenue: number;
  avgCycleTimeDays: number | null;
  avgSaleValue: number;
  pipelineValue: number;
}

const MAX_CYCLE_DAYS = 180;

function computeCycleDays(draft: DraftOrderNode): number | null {
  if (draft.status !== "COMPLETED" || !draft.order?.createdAt) return null;
  const days =
    (new Date(draft.order.createdAt).getTime() - new Date(draft.createdAt).getTime()) /
    (1000 * 60 * 60 * 24);
  if (days < 0.1 || days > MAX_CYCLE_DAYS) return null; // exclude < ~2.4 hours (likely test/instant orders)
  return days;
}

/**
 * Fetch pipeline metrics and rep leaderboard in a single pass.
 * Fixes: toDate filtering, value-based win rate, single fetch, rep tag filtering.
 */
export async function getFullPipelineData(
  storeIds: string[],
  fromDate: Date,
  toDate: Date,
  knownRepTags: string[],
): Promise<{ metrics: PipelineMetrics; leaderboard: RepPipelineEntry[]; warnings: FetchWarning[] }> {
  const { data: allDrafts, warnings } = await fetchAllDraftOrders(storeIds, toDateStr(fromDate));

  // Filter by upper date bound
  const drafts = allDrafts.filter((d) => new Date(d.createdAt) < toDate);

  // ── Pipeline metrics ──────────────────────────────────────────────────────
  let completedCount = 0;
  let openCount = 0;
  let invoiceSentCount = 0;
  let pipelineValue = 0;
  let completedValue = 0;
  let totalQuotedValue = 0;
  const cycleTimes: number[] = [];

  const monthMap = new Map<
    string,
    { created: number; converted: number; pipelineVal: number; revenue: number }
  >();

  for (const draft of drafts) {
    const amount = calcNetRevenue(draft);
    totalQuotedValue += amount;
    const month = draft.createdAt.slice(0, 7);
    const entry = monthMap.get(month) ?? { created: 0, converted: 0, pipelineVal: 0, revenue: 0 };
    entry.created++;

    if (draft.status === "COMPLETED") {
      completedCount++;
      completedValue += amount;
      entry.converted++;
      entry.revenue += amount;
      const cycle = computeCycleDays(draft);
      if (cycle !== null) cycleTimes.push(cycle);
    } else if (draft.status === "INVOICE_SENT") {
      invoiceSentCount++;
      pipelineValue += amount;       // only invoiced drafts count as pipeline
      entry.pipelineVal += amount;
    } else {
      openCount++;
      // OPEN drafts are quotes still being worked on — not pipeline
    }

    monthMap.set(month, entry);
  }

  const totalDrafts = drafts.length;
  const conversionRate = totalDrafts > 0 ? Math.round((completedCount / totalDrafts) * 1000) / 10 : 0;
  const avgCycleTimeDays =
    cycleTimes.length > 0
      ? Math.round((cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) * 10) / 10
      : 0;
  const avgSaleValue =
    completedCount > 0 ? Math.round((completedValue / completedCount) * 100) / 100 : 0;

  // Value-based win rate: completed$ / (completed$ + pipeline$)
  const winRateDenom = completedValue + pipelineValue;
  const valueWinRate = winRateDenom > 0
    ? Math.round((completedValue / winRateDenom) * 1000) / 10
    : 0;
  const predictedRevenue = Math.round(pipelineValue * (valueWinRate / 100) * 100) / 100;

  const monthlyTrend = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      draftsCreated: data.created,
      draftsConverted: data.converted,
      conversionRate: data.created > 0 ? Math.round((data.converted / data.created) * 1000) / 10 : 0,
      pipelineValue: Math.round(data.pipelineVal * 100) / 100,
      revenue: Math.round(data.revenue * 100) / 100,
    }));

  const metrics: PipelineMetrics = {
    totalQuotedValue: Math.round(totalQuotedValue * 100) / 100,
    wonRevenue: Math.round(completedValue * 100) / 100,
    conversionRate,
    valueWinRate,
    avgCycleTimeDays,
    pipelineValue: Math.round(pipelineValue * 100) / 100,
    avgSaleValue,
    totalDrafts,
    completedDrafts: completedCount,
    openDrafts: openCount,
    invoiceSentDrafts: invoiceSentCount,
    predictedRevenue,
    predictedTimelineDays: avgCycleTimeDays,
    monthlyTrend,
  };

  // ── Rep leaderboard (only known employee tags) ────────────────────────────
  const knownRepSet = new Set(knownRepTags.map((t) => t.toLowerCase()));

  const repMap = new Map<
    string,
    {
      total: number;
      completed: number;
      open: number;
      quoted: number;
      won: number;
      pipeline: number;
      cycleTimes: number[];
    }
  >();

  for (const draft of drafts) {
    const amount = calcNetRevenue(draft);
    const isCompleted = draft.status === "COMPLETED";
    const isOpen = draft.status === "OPEN" || draft.status === "INVOICE_SENT";

    for (const tag of draft.tags) {
      const key = tag.toLowerCase();
      if (!knownRepSet.has(key)) continue; // only count known employee tags
      const entry = repMap.get(key) ?? {
        total: 0, completed: 0, open: 0, quoted: 0, won: 0, pipeline: 0, cycleTimes: [],
      };
      entry.total++;
      entry.quoted += amount;
      if (isCompleted) {
        entry.completed++;
        entry.won += amount;
        const cycle = computeCycleDays(draft);
        if (cycle !== null) entry.cycleTimes.push(cycle);
      }
      if (isOpen) {
        entry.open++;
        entry.pipeline += amount;
      }
      repMap.set(key, entry);
    }
  }

  const leaderboard = Array.from(repMap.entries())
    .map(([tag, d]) => ({
      repTag: tag,
      totalDrafts: d.total,
      completedDrafts: d.completed,
      openDrafts: d.open,
      conversionRate: d.total > 0 ? Math.round((d.completed / d.total) * 1000) / 10 : 0,
      totalQuoted: Math.round(d.quoted * 100) / 100,
      wonRevenue: Math.round(d.won * 100) / 100,
      avgCycleTimeDays:
        d.cycleTimes.length > 0
          ? Math.round((d.cycleTimes.reduce((a, b) => a + b, 0) / d.cycleTimes.length) * 10) / 10
          : null,
      avgSaleValue:
        d.completed > 0 ? Math.round((d.won / d.completed) * 100) / 100 : 0,
      pipelineValue: Math.round(d.pipeline * 100) / 100,
    }))
    .sort((a, b) => b.wonRevenue - a.wonRevenue);

  return { metrics, leaderboard, warnings };
}

// --------------- Age-Based Pipeline Prediction ---------------

export interface AgeBucket {
  label: string;
  minAge: number;
  maxAge: number;
  drafts: number;
  value: number;
  conversionRate: number; // 0-100
  predictedValue: number;
}

export interface MonthlyForecast {
  month: string;        // "2026-05"
  monthLabel: string;   // "May '26"
  forecast: number;     // projected total revenue
  lastYearRevenue: number | null; // same month last year (null if no data)
  fromPipeline: number; // revenue already quoted/invoiced for this month
  isFallback: boolean;  // true if no prior year data, used avg instead
}

export interface SeasonalMonth {
  month: string;        // "2025-06"
  monthLabel: string;   // "Jun '25"
  revenue: number;
  momGrowth: number | null; // month-over-month % change, null for first month
}

export interface GrowthBasisMonth {
  month: string;       // "2026-01"
  monthLabel: string;  // "Jan '26"
  revenue: number;
  priorYearMonth: string;
  priorYearRevenue: number;
}

export interface PipelinePrediction {
  totalPipelineValue: number;
  totalPredictedRevenue: number;
  avgMonthlyRevenue: number;
  avgCycleTimeDays: number;
  yoyGrowthRate: number;          // e.g. 0.286 for +28.6%
  yoyGrowthBasis: string;         // e.g. "Jan–Mar '26 vs Jan–Mar '25"
  growthBasisMonths: GrowthBasisMonth[]; // the 3 months used to compute YoY
  monthlyForecasts: MonthlyForecast[]; // next 12 months
  annualForecast: number;          // sum of monthly forecasts
  buckets: AgeBucket[];
  seasonalPattern: SeasonalMonth[]; // last ~24 months of MoM changes
}

const PREDICTION_BUCKETS = [
  { label: "0\u20137 days", minAge: 0, maxAge: 7 },
  { label: "8\u201314 days", minAge: 8, maxAge: 14 },
  { label: "15\u201330 days", minAge: 15, maxAge: 30 },
  { label: "31\u201360 days", minAge: 31, maxAge: 60 },
  { label: "61\u201390 days", minAge: 61, maxAge: 90 },
  { label: "91\u2013180 days", minAge: 91, maxAge: 180 },
  { label: "181\u2013365 days", minAge: 181, maxAge: 365 },
  { label: "Over 1 year", minAge: 366, maxAge: Infinity },
];

/**
 * Revenue forecast using:
 * 1. Total order revenue (not just drafts) for historical baseline
 * 2. YoY growth rate from last 3 completed months vs same period last year
 * 3. Month-by-month projection: last year same month × (1 + YoY growth)
 * 4. Pipeline overlay: invoiced drafts weighted by conversion probability
 */
export async function getPipelinePrediction(
  storeIds: string[],
): Promise<PipelinePrediction> {
  const now = new Date();
  const historyStart = new Date();
  historyStart.setFullYear(historyStart.getFullYear() - 2);
  const dateStr = toDateStr(historyStart);

  // Fetch orders + drafts in parallel for full historical picture
  const [ordersResult, draftsResult] = await Promise.all([
    fetchAllOrders(storeIds, dateStr),
    fetchAllDraftOrders(storeIds, dateStr),
  ]);
  const allOrders = ordersResult.data;
  const allDrafts = draftsResult.data;

  // ── 1. Build monthly TOTAL revenue from real orders ─────────────────────
  const monthlyRevenue = new Map<string, number>();
  for (const order of allOrders) {
    if (order.cancelledAt) continue;
    const month = order.createdAt.slice(0, 7);
    monthlyRevenue.set(month, (monthlyRevenue.get(month) ?? 0) + calcOrderNetRevenue(order));
  }

  const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ── 2. YoY growth from last 3 completed months ─────────────────────────
  // Find last completed month (the month before current)
  const lastCompletedDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const recentKeys: string[] = [];
  const priorYearKeys: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(lastCompletedDate.getFullYear(), lastCompletedDate.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    recentKeys.push(key);
    const py = new Date(d.getFullYear() - 1, d.getMonth(), 1);
    priorYearKeys.push(`${py.getFullYear()}-${String(py.getMonth() + 1).padStart(2, "0")}`);
  }

  const recentTotal = recentKeys.reduce((s, k) => s + (monthlyRevenue.get(k) ?? 0), 0);
  const priorTotal = priorYearKeys.reduce((s, k) => s + (monthlyRevenue.get(k) ?? 0), 0);
  const yoyGrowthRate = priorTotal > 0 ? (recentTotal - priorTotal) / priorTotal : 0;

  // Human-readable basis label
  const basisStart = recentKeys[recentKeys.length - 1]; // earliest
  const basisEnd = recentKeys[0]; // latest
  const fmtBasis = (k: string) => {
    const [y, m] = k.split("-");
    return `${MONTH_LABELS[parseInt(m, 10) - 1]} '${y.slice(2)}`;
  };
  const yoyGrowthBasis = `${fmtBasis(basisStart)}–${fmtBasis(basisEnd)} vs prior year`;

  // Build detailed basis for calculation display
  const growthBasisMonths: GrowthBasisMonth[] = recentKeys.map((key, i) => ({
    month: key,
    monthLabel: fmtBasis(key),
    revenue: Math.round((monthlyRevenue.get(key) ?? 0) * 100) / 100,
    priorYearMonth: priorYearKeys[i],
    priorYearRevenue: Math.round((monthlyRevenue.get(priorYearKeys[i]) ?? 0) * 100) / 100,
  })).reverse(); // chronological order

  // ── 3. Seasonal pattern from historical data ────────────────────────────
  const sortedMonths = [...monthlyRevenue.entries()]
    .filter(([m]) => m < currentMonth)
    .sort(([a], [b]) => a.localeCompare(b));

  const seasonalPattern: SeasonalMonth[] = [];
  for (let i = 0; i < sortedMonths.length; i++) {
    const [monthKey, revenue] = sortedMonths[i];
    const [y, m] = monthKey.split("-");
    const label = `${MONTH_LABELS[parseInt(m, 10) - 1]} '${y.slice(2)}`;
    let momGrowth: number | null = null;
    if (i > 0) {
      const prevRev = sortedMonths[i - 1][1];
      if (prevRev > 0) momGrowth = Math.round(((revenue - prevRev) / prevRev) * 1000) / 10;
    }
    seasonalPattern.push({ month: monthKey, monthLabel: label, revenue: Math.round(revenue * 100) / 100, momGrowth });
  }

  // Average monthly revenue from last 6 completed months (fallback)
  const last6 = sortedMonths.slice(-6);
  const avgMonthlyRevenue = last6.length > 0
    ? last6.reduce((s, [, r]) => s + r, 0) / last6.length
    : 0;

  // ── 4. Month-by-month forecast for next 12 months ──────────────────────
  const monthlyForecasts: MonthlyForecast[] = [];
  for (let i = 1; i <= 12; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mm = String(futureDate.getMonth() + 1).padStart(2, "0");
    const yyyy = futureDate.getFullYear();
    const monthKey = `${yyyy}-${mm}`;
    const monthLabel = `${MONTH_LABELS[futureDate.getMonth()]} '${String(yyyy).slice(2)}`;

    const lastYearKey = `${yyyy - 1}-${mm}`;
    const lastYearRev = monthlyRevenue.get(lastYearKey);
    const hasLastYear = lastYearRev !== undefined && lastYearRev > 0;

    const baseRevenue = hasLastYear ? lastYearRev! : avgMonthlyRevenue;
    const forecast = baseRevenue * (1 + yoyGrowthRate);

    monthlyForecasts.push({
      month: monthKey,
      monthLabel,
      forecast: Math.round(forecast * 100) / 100,
      lastYearRevenue: hasLastYear ? Math.round(lastYearRev! * 100) / 100 : null,
      fromPipeline: 0, // filled below
      isFallback: !hasLastYear,
    });
  }

  // ── 5. Pipeline analysis: age-based conversion + per-month overlay ─────
  const pipeline = allDrafts.filter((d) => d.status === "INVOICE_SENT");

  // Resolved cohort for survival analysis
  const MATURITY_DAYS = 180;
  const maturityCutoff = new Date(now.getTime() - MATURITY_DAYS * 86_400_000);
  const resolvedCohort = allDrafts.filter((d) => new Date(d.createdAt) < maturityCutoff);
  const completedInCohort = resolvedCohort.filter((d) => d.status === "COMPLETED");

  const cycleTimes: number[] = [];
  for (const draft of completedInCohort) {
    const days = draft.order?.createdAt
      ? Math.max(0, (new Date(draft.order.createdAt).getTime() - new Date(draft.createdAt).getTime()) / 86_400_000)
      : 0;
    cycleTimes.push(days);
  }
  const sortedCycles = cycleTimes.sort((a, b) => a - b);
  const cohortTotal = resolvedCohort.length;
  const cohortCompleted = completedInCohort.length;

  function conversionProbAtAge(age: number): number {
    if (cohortTotal === 0) return 0;
    let completedByAge = 0;
    for (const c of sortedCycles) { if (c <= age) completedByAge++; else break; }
    const pendingAtAge = cohortTotal - completedByAge;
    if (pendingAtAge === 0) return 0;
    return (cohortCompleted - completedByAge) / pendingAtAge;
  }

  // Estimate which month each pipeline draft is likely to close in
  // Use average cycle time for remaining days estimate
  const filteredCycles = cycleTimes.filter((d) => d >= 0.1 && d <= MAX_CYCLE_DAYS);
  const avgCycleTimeDays = filteredCycles.length > 0
    ? Math.round((filteredCycles.reduce((a, b) => a + b, 0) / filteredCycles.length) * 10) / 10
    : 30; // default 30 days if no data

  const buckets: AgeBucket[] = PREDICTION_BUCKETS.map((b) => ({
    ...b, drafts: 0, value: 0, conversionRate: 0, predictedValue: 0,
  }));

  let totalPipelineValue = 0;
  let totalPredictedRevenue = 0;

  for (const draft of pipeline) {
    const age = (now.getTime() - new Date(draft.createdAt).getTime()) / 86_400_000;
    const amount = calcNetRevenue(draft);
    const prob = conversionProbAtAge(age);
    const predicted = amount * prob;

    totalPipelineValue += amount;
    totalPredictedRevenue += predicted;

    // Estimate close month: draft age + remaining expected days
    const remainingDays = Math.max(0, avgCycleTimeDays - age);
    const expectedCloseDate = new Date(now.getTime() + remainingDays * 86_400_000);
    const closeMonth = `${expectedCloseDate.getFullYear()}-${String(expectedCloseDate.getMonth() + 1).padStart(2, "0")}`;

    // Add weighted pipeline value to the matching forecast month
    const forecastMonth = monthlyForecasts.find((f) => f.month === closeMonth);
    if (forecastMonth) {
      forecastMonth.fromPipeline += predicted;
    }

    const bucket = buckets.find((b) => age >= b.minAge && age <= b.maxAge);
    if (bucket) {
      bucket.drafts++;
      bucket.value += amount;
      bucket.predictedValue += predicted;
    }
  }

  // Round pipeline values
  for (const f of monthlyForecasts) {
    f.fromPipeline = Math.round(f.fromPipeline * 100) / 100;
  }

  // Effective conversion rate per bucket
  for (const bucket of buckets) {
    bucket.conversionRate = bucket.value > 0 ? Math.round((bucket.predictedValue / bucket.value) * 1000) / 10 : 0;
    bucket.value = Math.round(bucket.value * 100) / 100;
    bucket.predictedValue = Math.round(bucket.predictedValue * 100) / 100;
  }

  const annualForecast = monthlyForecasts.reduce((s, f) => s + f.forecast, 0);

  return {
    totalPipelineValue: Math.round(totalPipelineValue * 100) / 100,
    totalPredictedRevenue: Math.round(totalPredictedRevenue * 100) / 100,
    avgMonthlyRevenue: Math.round(avgMonthlyRevenue * 100) / 100,
    avgCycleTimeDays,
    yoyGrowthRate: Math.round(yoyGrowthRate * 1000) / 1000,
    yoyGrowthBasis,
    growthBasisMonths,
    monthlyForecasts,
    annualForecast: Math.round(annualForecast * 100) / 100,
    buckets: buckets.filter((b) => b.drafts > 0),
    seasonalPattern,
  };
}

// --------------- Order Channel Split ---------------

export interface RepChannelEntry {
  repTag: string;
  orders: number;
  revenue: number;
  aov: number;
}

export interface OrderChannelMetrics {
  totalOrders: number;
  totalRevenue: number;
  draftOrders: number;
  draftRevenue: number;
  draftAOV: number;
  directOrders: number;
  directRevenue: number;
  directAOV: number;
  draftRevenueShare: number; // 0-100
  employeeBreakdown: RepChannelEntry[];
  monthlyTrend: {
    month: string;
    draftOrders: number;
    draftRevenue: number;
    directOrders: number;
    directRevenue: number;
    draftRevenueShare: number;
  }[];
}

/**
 * Fetch orders split by channel: draft-order-originated vs direct web purchases.
 * Cross-references orders with completed draft orders to determine source reliably.
 */
export async function getOrderChannelMetrics(
  storeIds: string[],
  fromDate: Date,
  toDate: Date,
  knownRepTags: string[] = [],
): Promise<OrderChannelMetrics> {
  const dateStr = toDateStr(fromDate);
  const knownRepSet = new Set(knownRepTags.map((t) => t.toLowerCase()));

  // Fetch all orders and all draft orders in parallel
  const [ordersResult, draftsResult] = await Promise.all([
    fetchAllOrders(storeIds, dateStr),
    fetchAllDraftOrders(storeIds, dateStr),
  ]);
  const allOrders = ordersResult.data;
  const allDrafts = draftsResult.data;

  // Build set of order GIDs that originated from a draft order
  const draftOrderIds = new Set<string>();
  for (const draft of allDrafts) {
    if (draft.status === "COMPLETED" && draft.order?.id) {
      draftOrderIds.add(draft.order.id);
    }
  }

  // Filter by toDate, exclude cancelled, and split by source
  const draftOrders: OrderNode[] = [];
  const directOrders: OrderNode[] = [];

  for (const order of allOrders) {
    if (order.cancelledAt) continue; // skip cancelled orders
    if (new Date(order.createdAt) >= toDate) continue;
    if (draftOrderIds.has(order.id)) {
      draftOrders.push(order);
    } else {
      directOrders.push(order);
    }
  }

  // Compute per-channel metrics (using post-refund subtotals)
  function computeChannel(orders: OrderNode[]) {
    let revenue = 0;
    const monthMap = new Map<string, { count: number; rev: number }>();
    for (const order of orders) {
      const amount = calcOrderNetRevenue(order);
      revenue += amount;
      const month = order.createdAt.slice(0, 7);
      const entry = monthMap.get(month) ?? { count: 0, rev: 0 };
      entry.count++;
      entry.rev += amount;
      monthMap.set(month, entry);
    }
    return { count: orders.length, revenue, monthMap };
  }

  const draft = computeChannel(draftOrders);
  const direct = computeChannel(directOrders);

  // Employee attribution for draft-sourced orders
  // Uses staffMember when read_users scope is enabled, falls back to tags.
  const empMap = new Map<string, { orders: number; revenue: number }>();
  for (const order of draftOrders) {
    const amount = calcOrderNetRevenue(order);

    if (order.staffMember?.firstName || order.staffMember?.lastName) {
      const name = [order.staffMember.firstName, order.staffMember.lastName]
        .filter(Boolean)
        .join(" ");
      const key = name.toLowerCase();
      const entry = empMap.get(key) ?? { orders: 0, revenue: 0 };
      entry.orders++;
      entry.revenue += amount;
      empMap.set(key, entry);
      continue;
    }

    let matched = false;
    for (const tag of order.tags) {
      const key = tag.toLowerCase();
      if (knownRepSet.has(key)) {
        const entry = empMap.get(key) ?? { orders: 0, revenue: 0 };
        entry.orders++;
        entry.revenue += amount;
        empMap.set(key, entry);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const entry = empMap.get("(unassigned)") ?? { orders: 0, revenue: 0 };
      entry.orders++;
      entry.revenue += amount;
      empMap.set("(unassigned)", entry);
    }
  }

  const employeeBreakdown: RepChannelEntry[] = Array.from(empMap.entries())
    .map(([tag, d]) => ({
      repTag: tag,
      orders: d.orders,
      revenue: Math.round(d.revenue * 100) / 100,
      aov: d.orders > 0 ? Math.round((d.revenue / d.orders) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalOrders = draft.count + direct.count;
  const totalRevenue = draft.revenue + direct.revenue;

  // Build monthly trend
  const allMonths = new Set([...draft.monthMap.keys(), ...direct.monthMap.keys()]);
  const monthlyTrend = Array.from(allMonths)
    .sort()
    .map((month) => {
      const d = draft.monthMap.get(month) ?? { count: 0, rev: 0 };
      const w = direct.monthMap.get(month) ?? { count: 0, rev: 0 };
      const monthTotal = d.rev + w.rev;
      return {
        month,
        draftOrders: d.count,
        draftRevenue: Math.round(d.rev * 100) / 100,
        directOrders: w.count,
        directRevenue: Math.round(w.rev * 100) / 100,
        draftRevenueShare: monthTotal > 0 ? Math.round((d.rev / monthTotal) * 1000) / 10 : 0,
      };
    });

  return {
    totalOrders,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    draftOrders: draft.count,
    draftRevenue: Math.round(draft.revenue * 100) / 100,
    draftAOV: draft.count > 0 ? Math.round((draft.revenue / draft.count) * 100) / 100 : 0,
    directOrders: direct.count,
    directRevenue: Math.round(direct.revenue * 100) / 100,
    directAOV: direct.count > 0 ? Math.round((direct.revenue / direct.count) * 100) / 100 : 0,
    draftRevenueShare: totalRevenue > 0 ? Math.round((draft.revenue / totalRevenue) * 1000) / 10 : 0,
    employeeBreakdown,
    monthlyTrend,
  };
}

// --------------- Helpers ---------------

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}
