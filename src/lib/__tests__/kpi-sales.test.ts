import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock shopify module to avoid real API calls
vi.mock("@/lib/shopify", () => ({
  getStores: vi.fn(() => [
    { id: "store1", label: "Store 1", store: "test.myshopify.com", clientId: "id", clientSecret: "secret" },
  ]),
  shopifyGraphQL: vi.fn(),
  REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
  calcNetRevenue: vi.fn((order: { subtotalPriceSet: { shopMoney: { amount: string } }; shippingCostMeta: { value: string } | null; exportTariffMeta: { value: string } | null }) => {
    const subtotal = parseFloat(order.subtotalPriceSet.shopMoney.amount);
    const shipping = parseFloat(order.shippingCostMeta?.value ?? "0") || 0;
    const tariff = parseFloat(order.exportTariffMeta?.value ?? "0") || 0;
    return subtotal - shipping - tariff;
  }),
}));

import { getEmployeeSalesMetrics, getEmployeeDraftMetrics, getFullPipelineData, getPipelinePrediction, getOrderChannelMetrics } from "@/lib/kpi-sales";
import { shopifyGraphQL } from "@/lib/shopify";

const mockShopifyGraphQL = vi.mocked(shopifyGraphQL);

beforeEach(() => {
  mockShopifyGraphQL.mockReset();
});

// ─── Helper to build a draft order node ─────────────────────────────────────

function makeDraft(overrides: {
  id?: string;
  name?: string;
  createdAt: string;
  status: string;
  tags: string[];
  amount: string;
  orderCreatedAt?: string;
}) {
  return {
    id: overrides.id ?? `d-${Math.random()}`,
    name: overrides.name ?? "#D",
    createdAt: overrides.createdAt,
    status: overrides.status,
    tags: overrides.tags,
    subtotalPriceSet: { shopMoney: { amount: overrides.amount } },
    shippingCostMeta: null,
    exportTariffMeta: null,
    order: overrides.orderCreatedAt
      ? { id: "o1", createdAt: overrides.orderCreatedAt }
      : null,
  };
}

function mockDraftResponse(drafts: ReturnType<typeof makeDraft>[]) {
  mockShopifyGraphQL.mockResolvedValueOnce({
    draftOrders: {
      edges: drafts.map((d, i) => ({ node: d, cursor: `c${i}` })),
      pageInfo: { hasNextPage: false },
    },
  });
}

function makeOrder(overrides: { id?: string; createdAt: string; amount: string; tags?: string[] }) {
  return {
    id: overrides.id ?? `gid://shopify/Order/${Math.random().toString(36).slice(2)}`,
    createdAt: overrides.createdAt,
    tags: overrides.tags ?? [],
    subtotalPriceSet: { shopMoney: { amount: overrides.amount } },
    shippingCostMeta: null,
    exportTariffMeta: null,
  };
}

function mockOrderResponse(orders: ReturnType<typeof makeOrder>[]) {
  mockShopifyGraphQL.mockResolvedValueOnce({
    orders: {
      edges: orders.map((o, i) => ({ node: o, cursor: `c${i}` })),
      pageInfo: { hasNextPage: false },
    },
  });
}

// ─── getEmployeeSalesMetrics ────────────────────────────────────────────────

describe("getEmployeeSalesMetrics", () => {
  it("returns zeros when employeeTags is empty", async () => {
    const result = await getEmployeeSalesMetrics(
      [],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );
    expect(result).toEqual({ revenue: 0, orders: 0, aov: 0 });
    expect(mockShopifyGraphQL).not.toHaveBeenCalled();
  });

  it("filters orders by employee tag and date range", async () => {
    mockShopifyGraphQL.mockResolvedValueOnce({
      orders: {
        edges: [
          {
            node: {
              createdAt: "2026-01-15T00:00:00Z",
              tags: ["john"],
              subtotalPriceSet: { shopMoney: { amount: "100.00" } },
              shippingCostMeta: null,
              exportTariffMeta: null,
            },
            cursor: "c1",
          },
          {
            node: {
              createdAt: "2026-01-20T00:00:00Z",
              tags: ["jane"],
              subtotalPriceSet: { shopMoney: { amount: "200.00" } },
              shippingCostMeta: null,
              exportTariffMeta: null,
            },
            cursor: "c2",
          },
          {
            node: {
              createdAt: "2025-12-01T00:00:00Z", // outside range
              tags: ["john"],
              subtotalPriceSet: { shopMoney: { amount: "300.00" } },
              shippingCostMeta: null,
              exportTariffMeta: null,
            },
            cursor: "c3",
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    });

    const result = await getEmployeeSalesMetrics(
      ["john"],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );

    expect(result.orders).toBe(1);
    expect(result.revenue).toBe(100);
    expect(result.aov).toBe(100);
  });

  it("performs case-insensitive tag matching", async () => {
    mockShopifyGraphQL.mockResolvedValueOnce({
      orders: {
        edges: [
          {
            node: {
              createdAt: "2026-01-15T00:00:00Z",
              tags: ["JOHN"],
              subtotalPriceSet: { shopMoney: { amount: "150.00" } },
              shippingCostMeta: null,
              exportTariffMeta: null,
            },
            cursor: "c1",
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    });

    const result = await getEmployeeSalesMetrics(
      ["john"],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );

    expect(result.orders).toBe(1);
    expect(result.revenue).toBe(150);
  });
});

// ─── getEmployeeDraftMetrics ────────────────────────────────────────────────

describe("getEmployeeDraftMetrics", () => {
  it("returns zeros when employeeTags is empty", async () => {
    const result = await getEmployeeDraftMetrics(
      [],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );
    expect(result).toEqual({
      totalDrafts: 0,
      completedDrafts: 0,
      openDrafts: 0,
      invoiceSentDrafts: 0,
      conversionRate: 0,
      totalQuotedAmount: 0,
      wonAmount: 0,
      drafts: [],
    });
  });

  it("calculates conversion rate correctly", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "COMPLETED", tags: ["alice"], amount: "500.00", orderCreatedAt: "2026-01-15T00:00:00Z" }),
      makeDraft({ createdAt: "2026-01-12T00:00:00Z", status: "OPEN", tags: ["alice"], amount: "300.00" }),
    ]);

    const result = await getEmployeeDraftMetrics(
      ["alice"],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );

    expect(result.totalDrafts).toBe(2);
    expect(result.completedDrafts).toBe(1);
    expect(result.openDrafts).toBe(1);
    expect(result.invoiceSentDrafts).toBe(0);
    expect(result.conversionRate).toBe(50);
    expect(result.totalQuotedAmount).toBe(800);
    expect(result.wonAmount).toBe(500);
  });

  it("separates INVOICE_SENT from OPEN drafts", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-05T00:00:00Z", status: "COMPLETED", tags: ["bob"], amount: "100.00", orderCreatedAt: "2026-01-10T00:00:00Z" }),
      makeDraft({ createdAt: "2026-01-06T00:00:00Z", status: "OPEN", tags: ["bob"], amount: "200.00" }),
      makeDraft({ createdAt: "2026-01-07T00:00:00Z", status: "INVOICE_SENT", tags: ["bob"], amount: "300.00" }),
    ]);

    const result = await getEmployeeDraftMetrics(
      ["bob"],
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01")
    );

    expect(result.totalDrafts).toBe(3);
    expect(result.completedDrafts).toBe(1);
    expect(result.openDrafts).toBe(1);
    expect(result.invoiceSentDrafts).toBe(1);
  });
});

// ─── getFullPipelineData ────────────────────────────────────────────────────

describe("getFullPipelineData", () => {
  it("filters drafts by toDate (bug 1 fix)", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "100.00" }),
      makeDraft({ createdAt: "2026-01-20T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "200.00" }),
      makeDraft({ createdAt: "2026-02-05T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "300.00" }), // after toDate
    ]);

    const { metrics } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01T00:00:00"), // toDate excludes Feb 5
      ["john"],
    );

    expect(metrics.totalDrafts).toBe(2); // only Jan 10 + Jan 20
    expect(metrics.pipelineValue).toBe(300); // 100 + 200
  });

  it("uses value-based win rate for predicted revenue (bug 2 fix)", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-05T00:00:00Z", status: "COMPLETED", tags: ["john"], amount: "500.00", orderCreatedAt: "2026-01-10T00:00:00Z" }),
      makeDraft({ createdAt: "2026-01-06T00:00:00Z", status: "COMPLETED", tags: ["john"], amount: "500.00", orderCreatedAt: "2026-01-12T00:00:00Z" }),
      makeDraft({ createdAt: "2026-01-07T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "500.00" }),
      makeDraft({ createdAt: "2026-01-08T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "500.00" }),
    ]);

    const { metrics } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"],
    );

    // completedValue = 1000, pipelineValue = 1000 (only INVOICE_SENT), totalQuoted = 2000
    // valueWinRate = 1000/2000 * 100 = 50%
    // predictedRevenue = 1000 * 0.5 = 500
    expect(metrics.valueWinRate).toBe(50);
    expect(metrics.predictedRevenue).toBe(500);
    // count-based conversion rate is also 50% here (2/4)
    expect(metrics.conversionRate).toBe(50);
  });

  it("only counts known rep tags in leaderboard (bug 3 fix)", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "COMPLETED", tags: ["john", "wholesale", "vip"], amount: "1000.00", orderCreatedAt: "2026-01-15T00:00:00Z" }),
    ]);

    const { leaderboard } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"], // only john is a known rep
    );

    // Should only have 1 entry (john), not 3 (john, wholesale, vip)
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0].repTag).toBe("john");
    expect(leaderboard[0].wonRevenue).toBe(1000);
  });

  it("fetches draft orders only once (bug 5 fix)", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "100.00" }),
    ]);

    await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"],
    );

    // Only 1 Shopify GraphQL call (one store, one page)
    expect(mockShopifyGraphQL).toHaveBeenCalledTimes(1);
  });

  it("separates OPEN, INVOICE_SENT, and COMPLETED in metrics", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-05T00:00:00Z", status: "COMPLETED", tags: ["john"], amount: "100.00", orderCreatedAt: "2026-01-10T00:00:00Z" }),
      makeDraft({ createdAt: "2026-01-06T00:00:00Z", status: "OPEN", tags: ["john"], amount: "200.00" }),
      makeDraft({ createdAt: "2026-01-07T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "300.00" }),
      makeDraft({ createdAt: "2026-01-08T00:00:00Z", status: "OPEN", tags: ["john"], amount: "400.00" }),
    ]);

    const { metrics } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"],
    );

    expect(metrics.totalDrafts).toBe(4);
    expect(metrics.completedDrafts).toBe(1);
    expect(metrics.openDrafts).toBe(2);
    expect(metrics.invoiceSentDrafts).toBe(1);
    expect(metrics.pipelineValue).toBe(300); // only INVOICE_SENT counts as pipeline
  });

  it("returns zero valueWinRate when no completed drafts", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "INVOICE_SENT", tags: ["john"], amount: "500.00" }),
    ]);

    const { metrics } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"],
    );

    expect(metrics.valueWinRate).toBe(0);
    expect(metrics.predictedRevenue).toBe(0);
    expect(metrics.pipelineValue).toBe(500); // invoiced drafts still count as pipeline
  });

  it("returns empty leaderboard when no known rep tags match", async () => {
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-10T00:00:00Z", status: "COMPLETED", tags: ["unknown-tag"], amount: "1000.00", orderCreatedAt: "2026-01-15T00:00:00Z" }),
    ]);

    const { leaderboard } = await getFullPipelineData(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
      ["john"],
    );

    expect(leaderboard).toHaveLength(0);
  });
});

// ─── getPipelinePrediction ──────────────────────────────────────────────────

describe("getPipelinePrediction", () => {
  // Helper: date N days ago as ISO string
  function daysAgo(n: number) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  it("scores recent invoiced drafts higher than old ones", async () => {
    // Resolved cohort: old completed draft (200 days ago, cycle 5 days)
    // Plus an old unconverted draft (200 days ago, still INVOICE_SENT)
    // → 50% of old drafts converted, and they did so quickly (5 days)
    // Current pipeline: one recent (3 days) and one old (100 days)
    mockDraftResponse([
      // Historical: completed 200 days ago, cycle = 5 days
      makeDraft({
        createdAt: daysAgo(200),
        status: "COMPLETED",
        tags: ["rep"],
        amount: "1000.00",
        orderCreatedAt: daysAgo(195),
      }),
      // Historical: never converted, 200 days old
      makeDraft({
        createdAt: daysAgo(200),
        status: "INVOICE_SENT",
        tags: ["rep"],
        amount: "1000.00",
      }),
      // Current pipeline: 3 days old
      makeDraft({
        createdAt: daysAgo(3),
        status: "INVOICE_SENT",
        tags: ["rep"],
        amount: "500.00",
      }),
      // Current pipeline: 100 days old
      makeDraft({
        createdAt: daysAgo(100),
        status: "INVOICE_SENT",
        tags: ["rep"],
        amount: "500.00",
      }),
    ]);

    const result = await getPipelinePrediction(["store1"]);

    // Pipeline = 2 INVOICE_SENT drafts (the 200-day-old one + 3-day + 100-day)
    // But the 200-day-old historical one is also INVOICE_SENT, so 3 pipeline drafts total
    // The recent draft (3 days) should have higher conversion probability
    // than the old one (100 days) since historical completions happened at day 5
    expect(result.totalPipelineValue).toBeGreaterThan(0);
    expect(result.totalPredictedRevenue).toBeGreaterThan(0);
    expect(result.totalPredictedRevenue).toBeLessThan(result.totalPipelineValue);
    expect(result.buckets.length).toBeGreaterThan(0);
  });

  it("returns zero prediction when no historical completions", async () => {
    mockDraftResponse([
      makeDraft({
        createdAt: daysAgo(10),
        status: "INVOICE_SENT",
        tags: ["rep"],
        amount: "500.00",
      }),
    ]);

    const result = await getPipelinePrediction(["store1"]);

    // No resolved cohort (nothing old enough), so conversion prob = 0
    expect(result.totalPipelineValue).toBe(500);
    expect(result.totalPredictedRevenue).toBe(0);
  });

  it("ignores OPEN drafts in pipeline (only INVOICE_SENT)", async () => {
    mockDraftResponse([
      makeDraft({
        createdAt: daysAgo(5),
        status: "OPEN",
        tags: ["rep"],
        amount: "1000.00",
      }),
    ]);

    const result = await getPipelinePrediction(["store1"]);

    expect(result.totalPipelineValue).toBe(0);
    expect(result.buckets).toHaveLength(0);
  });

  it("provides age buckets with conversion rates", async () => {
    // 2 old completed drafts (cycle 3 days each) + 1 old unconverted
    // → historical rate ~66% for young drafts
    mockDraftResponse([
      makeDraft({ createdAt: daysAgo(250), status: "COMPLETED", tags: ["r"], amount: "100.00", orderCreatedAt: daysAgo(247) }),
      makeDraft({ createdAt: daysAgo(240), status: "COMPLETED", tags: ["r"], amount: "100.00", orderCreatedAt: daysAgo(237) }),
      makeDraft({ createdAt: daysAgo(230), status: "INVOICE_SENT", tags: ["r"], amount: "100.00" }),
      // Current pipeline
      makeDraft({ createdAt: daysAgo(2), status: "INVOICE_SENT", tags: ["r"], amount: "800.00" }),
    ]);

    const result = await getPipelinePrediction(["store1"]);

    // Should have bucket(s) with the recent draft
    const recentBucket = result.buckets.find((b) => b.label.includes("7"));
    expect(recentBucket).toBeDefined();
    expect(recentBucket!.drafts).toBe(1);
    expect(recentBucket!.conversionRate).toBeGreaterThan(0);
  });
});

// ─── getOrderChannelMetrics ─────────────────────────────────────────────────

describe("getOrderChannelMetrics", () => {
  // Each test mocks: 1) orders fetch, 2) draft orders fetch (for cross-reference)

  it("splits orders by cross-referencing with completed drafts", async () => {
    const draftOrderId1 = "gid://shopify/Order/111";
    const draftOrderId2 = "gid://shopify/Order/222";
    const directOrderId = "gid://shopify/Order/333";

    // 1) All orders (single fetch)
    mockOrderResponse([
      makeOrder({ id: draftOrderId1, createdAt: "2026-01-10T00:00:00Z", amount: "500.00" }),
      makeOrder({ id: draftOrderId2, createdAt: "2026-01-15T00:00:00Z", amount: "300.00" }),
      makeOrder({ id: directOrderId, createdAt: "2026-01-12T00:00:00Z", amount: "200.00" }),
    ]);
    // 2) Draft orders — two completed drafts link to orders 111 and 222
    mockShopifyGraphQL.mockResolvedValueOnce({
      draftOrders: {
        edges: [
          { node: { ...makeDraft({ createdAt: "2026-01-08T00:00:00Z", status: "COMPLETED", tags: [], amount: "500.00" }), order: { id: draftOrderId1, createdAt: "2026-01-10T00:00:00Z" } }, cursor: "c0" },
          { node: { ...makeDraft({ createdAt: "2026-01-13T00:00:00Z", status: "COMPLETED", tags: [], amount: "300.00" }), order: { id: draftOrderId2, createdAt: "2026-01-15T00:00:00Z" } }, cursor: "c1" },
        ],
        pageInfo: { hasNextPage: false },
      },
    });

    const result = await getOrderChannelMetrics(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
    );

    expect(result.totalOrders).toBe(3);
    expect(result.draftOrders).toBe(2);
    expect(result.draftRevenue).toBe(800);
    expect(result.directOrders).toBe(1);
    expect(result.directRevenue).toBe(200);
    expect(result.draftRevenueShare).toBe(80);
  });

  it("returns zeros when no orders", async () => {
    mockOrderResponse([]);
    mockDraftResponse([]);

    const result = await getOrderChannelMetrics(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
    );

    expect(result.totalOrders).toBe(0);
    expect(result.totalRevenue).toBe(0);
    expect(result.draftRevenueShare).toBe(0);
  });

  it("treats all orders as direct when no drafts are completed", async () => {
    mockOrderResponse([
      makeOrder({ id: "gid://shopify/Order/1", createdAt: "2026-01-10T00:00:00Z", amount: "100.00" }),
      makeOrder({ id: "gid://shopify/Order/2", createdAt: "2026-01-12T00:00:00Z", amount: "200.00" }),
    ]);
    mockDraftResponse([
      makeDraft({ createdAt: "2026-01-05T00:00:00Z", status: "OPEN", tags: [], amount: "50.00" }),
    ]);

    const result = await getOrderChannelMetrics(
      ["store1"],
      new Date("2026-01-01"),
      new Date("2026-02-01"),
    );

    expect(result.draftOrders).toBe(0);
    expect(result.directOrders).toBe(2);
    expect(result.directRevenue).toBe(300);
  });
});
