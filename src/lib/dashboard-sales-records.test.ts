import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSalesRepRecords } from "./dashboard-sales-records";
import { fetchAllPages } from "./shopify";

vi.mock("./supabase", () => ({ getSupabase: () => ({ from: () => {
  const builder = { select: () => builder, eq: () => builder, order: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: ["Rob", "Daniel", "Craig", "Marie"].map((name) => ({ id: name.toLowerCase(), name, department: "sales", shopify_tags: [] })), error: null }).then(resolve) };
  return builder;
} }) }));
vi.mock("./shopify", () => ({
  getStores: () => [{ id: "store1", store: "rf-test.myshopify.com", label: "RF" }, { id: "store3", store: "bc-test.myshopify.com", label: "BC" }],
  fetchAllPages: vi.fn(), REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
  calcNetRevenue: (record: { subtotalPriceSet: { shopMoney: { amount: string } } }) => Number(record.subtotalPriceSet.shopMoney.amount),
}));
const money = (amount: number) => ({ shopMoney: { amount: String(amount) } });
const order = (id: string, tags: string[], provinceCode = "ON", kind = "SALE", amount = 113) => ({
  id: `gid://shopify/Order/${id}`, name: `#${id}`, customer: { firstName: "Avery", lastName: "Chen" }, createdAt: "2026-01-01T12:00:00Z", tags,
  shippingAddress: { provinceCode, countryCodeV2: "CA", province: null }, billingAddress: null,
  currentTotalPriceSet: money(113), currentTotalTaxSet: money(13), currentShippingPriceSet: money(0),
  totalPriceSet: money(113), totalTaxSet: money(13), totalShippingPriceSet: money(0),
  transactions: [{ kind, status: "SUCCESS", processedAt: "2026-09-14T12:00:00Z", amountSet: money(amount) }],
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-16T12:00:00Z")); vi.mocked(fetchAllPages).mockReset(); });
afterEach(() => vi.useRealTimers());

it("lists older paid orders and refund-only orders using the dashboard ownership and net calculations", async () => {
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [order("1", ["Rob"]), order("2", ["Rob"], "ON", "REFUND", 56.5), order("3", ["Rob"], "QC"), order("4", ["Rob", "Craig"])], truncated: false });
  const result = await getSalesRepRecords("rob", "7d", "orders");
  expect(result.total).toBe(50);
  expect(result.records).toHaveLength(2);
  expect(result.records[0]).toMatchObject({ name: "#1", customerName: "Avery Chen", amount: 100, date: "2026-09-14T12:00:00Z", url: "https://rf-test.myshopify.com/admin/orders/1" });
  expect(result.records[1]).toMatchObject({ name: "#2", amount: -50, status: "Net refund" });
  expect(vi.mocked(fetchAllPages).mock.calls[0][0].variables?.filter).toBe("updated_at:>='2026-09-10T04:00:00.000Z'");
});

it("includes Aaron-tagged records outside BC and before the territory start alongside eligible untagged BC records", async () => {
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [{ ...order("1", [], "BC"), createdAt: "2026-08-01T12:00:00Z" }, order("2", ["Aaron"], "ON"), order("3", ["Aron"], "BC"), order("5", [], "BC"), { ...order("4", ["Rob"], "BC"), createdAt: "2026-08-01T12:00:00Z" }], truncated: false });
  const result = await getSalesRepRecords("sales-agent-aaron", "30d", "orders");
  expect(result.records.map((entry) => entry.name)).toEqual(["#1", "#2", "#3"]);
  expect(result.total).toBe(300);
  expect(vi.mocked(fetchAllPages).mock.calls[0][0].storeId).toBe("store1");
});

it("lists completed and sent quotes, excludes unsent and out-of-period quotes", async () => {
  const quote = (id: string, status: string, createdAt = "2026-09-14T12:00:00Z") => ({ ...order(id, ["Rob"]), id: `gid://shopify/DraftOrder/${id}`, status, createdAt, subtotalPriceSet: money(200) });
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [quote("1", "COMPLETED"), quote("2", "INVOICE_SENT"), quote("3", "OPEN"), quote("4", "COMPLETED", "2026-08-01T12:00:00Z")], truncated: false });
  const result = await getSalesRepRecords("rob", "7d", "quotes");
  expect(result.records).toHaveLength(2);
  expect(result.total).toBe(400);
  expect(result.records[0].url).toBe("https://rf-test.myshopify.com/admin/draft_orders/1");
  expect(result.records[0].customerName).toBe("Avery Chen");
});

it("lists Marie's Marijac-tagged BC orders and quotes", async () => {
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [order("1", ["Marijac"]), order("2", ["Marie"]), order("3", ["Marijac follow-up"])], truncated: false });
  const orders = await getSalesRepRecords("marie", "30d", "orders");
  expect(orders.records).toHaveLength(1);
  expect(orders.total).toBe(100);
  expect(orders.records[0].url).toBe("https://bc-test.myshopify.com/admin/orders/1");
  expect(vi.mocked(fetchAllPages).mock.calls[0][0].storeId).toBe("store3");
  expect(vi.mocked(fetchAllPages).mock.calls[0][0].variables?.filter).toContain('AND (tag:"marijac")');
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [
    { ...order("4", ["Marijac"]), id: "gid://shopify/DraftOrder/4", createdAt: "2026-09-14T12:00:00Z", status: "INVOICE_SENT", subtotalPriceSet: money(200) },
    { ...order("5", ["Marijac"]), createdAt: "2026-09-14T12:00:00Z", status: "OPEN", subtotalPriceSet: money(300) },
  ], truncated: false });
  const quotes = await getSalesRepRecords("marie", "30d", "quotes");
  expect(quotes.records).toHaveLength(1);
  expect(quotes.total).toBe(200);
  expect(vi.mocked(fetchAllPages).mock.calls[1][0].variables?.filter).toContain('AND (tag:"marijac")');
  expect(quotes.records[0].url).toBe("https://bc-test.myshopify.com/admin/draft_orders/4");
});

it("rejects incomplete lists", async () => {
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [], truncated: true });
  await expect(getSalesRepRecords("rob", "1y", "orders")).rejects.toThrow("incomplete");
});

it("includes Aaron and Aron tagged quotes outside BC while retaining territory and Rob priority", async () => {
  const quote = (id: string, tags: string[], province = "ON", status = "INVOICE_SENT") => ({ ...order(id, tags, province), id: `gid://shopify/DraftOrder/${id}`, createdAt: "2026-09-14T12:00:00Z", status, subtotalPriceSet: money(200) });
  vi.mocked(fetchAllPages).mockResolvedValue({ nodes: [quote("1", ["Aaron"]), quote("2", [" Aron "]), quote("3", ["Aaron"], "QC"), quote("4", ["Aaron", "Rob"]), quote("5", ["Aron"], "ON", "OPEN")], truncated: false });
  const result = await getSalesRepRecords("sales-agent-aaron", "30d", "quotes");
  expect(result.records.map((entry) => entry.name)).toEqual(["#1", "#2"]);
  expect(result.total).toBe(400);
});
