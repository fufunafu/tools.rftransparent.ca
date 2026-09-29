import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTopPerformers, getSalesTeamOverview } from "./ops-dashboard";
import { fetchAllPages } from "./shopify";

vi.mock("./api-cache", () => ({ cached: async (_key: string, _ttl: number, compute: () => Promise<unknown>) => ({ data: await compute(), cachedAt: null }) }));
vi.mock("./purchasing/queries", () => ({ getPurchasingSummary: vi.fn(), listProductsWithMetrics: vi.fn() }));
vi.mock("./settings", () => ({ getSalesTargets: vi.fn() }));
vi.mock("./collection", () => ({ fetchUnpaidOrders: vi.fn() }));
vi.mock("./shopify", () => ({
  getStores: () => [{ id: "store1", label: "RF" }, { id: "store2", label: "GRS" }, { id: "store3", label: "BC" }],
  fetchAllPages: vi.fn(),
  calcNetRevenue: () => 100,
  REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
}));
vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const data = table === "employees"
        ? ["Rob", "Daniel", "Craig", "Marie", "John"].map((name) => ({ id: name.toLowerCase(), name, department: "sales", shopify_tags: [name], locations: null }))
        : [];
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, gte: () => builder, range: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

const money = (amount: number) => ({ shopMoney: { amount: String(amount) } });
function order(tags: string[], provinceCode = "ON", kind = "SALE", processedAt = "2026-09-10T12:00:00Z") {
  return {
    createdAt: "2026-09-10T12:00:00Z", tags, shippingAddress: { provinceCode, province: null, countryCodeV2: "CA" }, billingAddress: null,
    currentTotalPriceSet: money(113), currentTotalTaxSet: money(13), currentShippingPriceSet: money(0),
    totalPriceSet: money(113), totalTaxSet: money(13), totalShippingPriceSet: money(0),
    transactions: [{ kind, status: "SUCCESS", processedAt, amountSet: money(113) }],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T15:00:00Z"));
  vi.mocked(fetchAllPages).mockImplementation(async ({ storeId, query }) => {
    const nodes = query.includes("draftOrders(")
      ? [{ ...order(storeId === "store1" ? [] : ["Marijac"], "QC"), createdAt: "2026-09-05T12:00:00Z", status: "COMPLETED" }]
      : storeId === "store1"
        ? [order(["Rob"]), order(["Craig"], "QC"), order(["Rob"], "ON", "SALE", "2026-08-10T12:00:00Z"), order(["Marijac"]), order(["Aaron"], "BC"), order(["aron"], "BC"), order(["aaron"], "ON")]
        : [order(["Marijac"], "QC", "REFUND"), order(["Rob"])];
    return { nodes, truncated: false };
  });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("sales dashboard data integration", () => {
  it("computes all five visible periods from a single Shopify history fetch", async () => {
    const result = await getSalesTeamOverview();
    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(result.value.periods)).toEqual(["7d", "30d", "90d", "180d", "1y"]);
    expect(fetchAllPages).toHaveBeenCalledTimes(4);
    expect(result.value.periods["7d"].find((rep) => rep.id === "rob")).toMatchObject({ value: 100, previous: 0 });
    expect(result.value.periods["30d"].find((rep) => rep.id === "rob")).toMatchObject({ value: 100, previous: 100 });
    expect(result.value.periods["1y"].find((rep) => rep.id === "rob")).toMatchObject({ value: 200, previous: 0 });
    for (const people of Object.values(result.value.periods)) {
      expect(people).toHaveLength(5);
      expect(people.find((rep) => rep.id === "sales-agent-aaron")?.value).toBe(200);
      expect(people.find((rep) => rep.id === "marie")?.value).toBe(-100);
    }
  });

  it("fetches payment updates, keeps store identity, attributes quotes, and retains all five reps", async () => {
    const result = await getTopPerformers();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.sales).toHaveLength(5);
    const byId = Object.fromEntries(result.value.sales.map((rep) => [rep.id, rep]));
    expect(byId.rob).toMatchObject({ value: 100, previous: 100 });
    expect(byId.daniel).toMatchObject({ value: 100, metrics: { quoted: 100, conversion: 100 } });
    expect(byId["sales-agent-aaron"]).toMatchObject({ name: "Aaron", value: 200, hasEmployeeProfile: false });
    expect(byId.craig).toMatchObject({ value: 0, previous: 0 });
    expect(byId.marie).toMatchObject({ value: -100, metrics: { quoted: 100, conversion: 100 }, meta: "1 order · 100.0% conv" });
    expect(result.value.warnings).toEqual([]);
    expect(fetchAllPages).toHaveBeenCalledTimes(4);
    for (const [options] of vi.mocked(fetchAllPages).mock.calls) {
      expect(["store1", "store3"]).toContain(options.storeId);
      if (options.storeId === "store3") expect(options.variables?.filter).toContain('AND (tag:"marijac")');
      else expect(options.variables?.filter).not.toContain("tag:");
      expect(options.variables?.filter).toMatch(options.query.includes("draftOrders(") ? /^created_at:/ : /^updated_at:/);
      expect(options.query).toContain("shippingAddress { provinceCode province countryCodeV2 name company }");
    }
  });

  it("reports failed and truncated sources instead of presenting them as complete", async () => {
    vi.mocked(fetchAllPages).mockImplementation(async ({ query }) => {
      if (!query.includes("draftOrders(")) throw new Error("Shopify unavailable");
      return { nodes: [], truncated: true };
    });
    const result = await getTopPerformers();
    if (!result.ok) throw new Error(result.error);
    expect(result.value.warnings).toEqual(expect.arrayContaining([
      "RF performer orders are unavailable", "RF performer quotes reached the pagination limit",
    ]));
    expect(result.value.sales).toHaveLength(5);
  });

  it.each([
    { period: "7d" as const, sold: 100, quoted: 0, from: "2026-09-02T04:00:00.000Z" },
    { period: "1y" as const, sold: 200, quoted: 100, from: "2024-09-16T04:00:00.000Z" },
  ])("recalculates sales, prior sales and quotes for $period", async ({ period, sold, quoted, from }) => {
    const result = await getTopPerformers(period);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.sales.find((rep) => rep.id === "rob")).toMatchObject({ value: sold, previous: 0 });
    expect(result.value.sales.find((rep) => rep.id === "daniel")?.metrics.quoted).toBe(quoted);
    const orderCall = vi.mocked(fetchAllPages).mock.calls.find(([options]) => !options.query.includes("draftOrders("));
    expect(orderCall?.[0].variables?.filter).toBe(`updated_at:>='${from}'`);
  });
});
