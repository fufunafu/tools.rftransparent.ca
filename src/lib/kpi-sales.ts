import { shopifyGraphQL, getStores, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";

// --------------- Types ---------------

interface OrderNode extends RevenueFields {
  createdAt: string;
  tags: string[];
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

// --------------- Queries ---------------

function makeOrdersQuery(dateFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>='${dateFilter}'"${after}) {
        edges {
          node { createdAt tags ${REVENUE_FIELDS} }
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

async function fetchAllOrders(
  storeIds: string[],
  fromDate: string
): Promise<OrderNode[]> {
  const stores = getStores();
  const allOrders: OrderNode[] = [];

  for (const store of stores) {
    if (!storeIds.includes(store.id)) continue;
    try {
      let cursor: string | undefined;
      let hasNext = true;
      let pages = 0;
      while (hasNext && pages < 20) {
        const data = await shopifyGraphQL<OrdersResponse>(
          store.id,
          makeOrdersQuery(fromDate, cursor)
        );
        const edges = data.orders.edges;
        allOrders.push(...edges.map((e) => e.node));
        hasNext = data.orders.pageInfo.hasNextPage;
        cursor = edges[edges.length - 1]?.cursor;
        pages++;
      }
    } catch (err) {
      console.error(`[kpi-sales] Order fetch failed for ${store.id}:`, err);
    }
  }

  return allOrders;
}

async function fetchAllDraftOrders(
  storeIds: string[],
  fromDate: string
): Promise<DraftOrderNode[]> {
  const stores = getStores();
  const allDrafts: DraftOrderNode[] = [];

  for (const store of stores) {
    if (!storeIds.includes(store.id)) continue;
    try {
      let cursor: string | undefined;
      let hasNext = true;
      let pages = 0;
      while (hasNext && pages < 20) {
        const data = await shopifyGraphQL<DraftOrdersResponse>(
          store.id,
          makeDraftOrdersQuery(fromDate, cursor)
        );
        const edges = data.draftOrders.edges;
        allDrafts.push(...edges.map((e) => e.node));
        hasNext = data.draftOrders.pageInfo.hasNextPage;
        cursor = edges[edges.length - 1]?.cursor;
        pages++;
      }
    } catch (err) {
      console.error(`[kpi-sales] Draft fetch FAILED for ${store.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[kpi-sales] fetchAllDraftOrders: ${allDrafts.length} drafts from ${storeIds.length} stores (requested: ${storeIds.join(", ")})`);
  return allDrafts;
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

  const allOrders = await fetchAllOrders(storeIds, toDateStr(startDate));

  let revenue = 0;
  let orderCount = 0;

  for (const order of allOrders) {
    const orderDate = new Date(order.createdAt);
    if (orderDate < startDate || orderDate >= endDate) continue;

    const orderTags = order.tags.map((t) => t.toLowerCase());
    if (!lowerTags.some((et) => orderTags.includes(et))) continue;

    revenue += calcNetRevenue(order);
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
      conversionRate: 0,
      totalQuotedAmount: 0,
      wonAmount: 0,
      drafts: [],
    };

  const allDrafts = await fetchAllDraftOrders(storeIds, toDateStr(startDate));

  const matchedDrafts: DraftOrderSummary[] = [];
  let completedCount = 0;
  let totalQuoted = 0;
  let wonAmount = 0;

  for (const draft of allDrafts) {
    const draftDate = new Date(draft.createdAt);
    if (draftDate < startDate || draftDate >= endDate) continue;

    const draftTags = draft.tags.map((t) => t.toLowerCase());
    if (!lowerTags.some((et) => draftTags.includes(et))) continue;

    const amount = calcNetRevenue(draft);
    const isCompleted = draft.status === "COMPLETED";

    totalQuoted += amount;
    if (isCompleted) {
      completedCount++;
      wonAmount += amount;
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
  const openCount = total - completedCount;

  return {
    totalDrafts: total,
    completedDrafts: completedCount,
    openDrafts: openCount,
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

  const allDrafts = await fetchAllDraftOrders(storeIds, toDateStr(startDate));

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
  conversionRate: number;
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

export async function getPipelineMetrics(
  storeIds: string[],
  fromDate: Date,
): Promise<PipelineMetrics> {
  const allDrafts = await fetchAllDraftOrders(storeIds, toDateStr(fromDate));

  let completedCount = 0;
  let openCount = 0;
  let invoiceSentCount = 0;
  let pipelineValue = 0;
  let completedValue = 0;
  const cycleTimes: number[] = [];

  // Monthly tracking
  const monthMap = new Map<
    string,
    { created: number; converted: number; pipelineVal: number; revenue: number }
  >();

  for (const draft of allDrafts) {
    const amount = calcNetRevenue(draft);
    const month = draft.createdAt.slice(0, 7); // "YYYY-MM"
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
      pipelineValue += amount;
      entry.pipelineVal += amount;
    } else {
      // OPEN
      openCount++;
      pipelineValue += amount;
      entry.pipelineVal += amount;
    }

    monthMap.set(month, entry);
  }

  const totalDrafts = allDrafts.length;
  const conversionRate = totalDrafts > 0 ? Math.round((completedCount / totalDrafts) * 1000) / 10 : 0;
  const avgCycleTimeDays =
    cycleTimes.length > 0
      ? Math.round((cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) * 10) / 10
      : 0;
  const avgSaleValue =
    completedCount > 0 ? Math.round((completedValue / completedCount) * 100) / 100 : 0;
  const predictedRevenue = Math.round(pipelineValue * (conversionRate / 100) * 100) / 100;

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

  return {
    conversionRate,
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
}

export async function getRepLeaderboard(
  storeIds: string[],
  fromDate: Date,
): Promise<RepPipelineEntry[]> {
  const allDrafts = await fetchAllDraftOrders(storeIds, toDateStr(fromDate));

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

  for (const draft of allDrafts) {
    const amount = calcNetRevenue(draft);
    const isCompleted = draft.status === "COMPLETED";
    const isOpen = draft.status === "OPEN" || draft.status === "INVOICE_SENT";

    for (const tag of draft.tags) {
      const key = tag.toLowerCase();
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

  return Array.from(repMap.entries())
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
}

// --------------- Helpers ---------------

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}
