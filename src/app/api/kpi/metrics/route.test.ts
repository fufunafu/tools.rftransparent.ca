import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { shopifyGraphQL } from "@/lib/shopify";

vi.mock("@/lib/admin-auth", () => ({ isAuthenticated: async () => true }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => {
  const builder = { select: () => builder, eq: () => builder, order: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "rob", name: "Rob", department: "sales", shopify_tags: ["rob"] }], error: null }).then(resolve) };
  return builder;
} }) }));
vi.mock("@/lib/shopify", () => ({ getStores: () => [{ id: "store1", label: "RF Transparent", store: "rf-test.myshopify.com" }], shopifyGraphQL: vi.fn() }));

beforeEach(() => {
  vi.mocked(shopifyGraphQL).mockReset();
  vi.mocked(shopifyGraphQL).mockImplementation(async (_storeId, query) => {
    const draft = query.includes("draftOrders(");
    const node = (amount: number, status = "COMPLETED") => ({ id: status, name: "Test", customer: { firstName: "Avery", lastName: "Chen" }, createdAt: "2026-08-10T12:00:00Z", tags: ["Rob"], status, subtotalPriceSet: { shopMoney: { amount: String(amount) } } });
    const nodes = draft ? [node(1000), node(1000, "INVOICE_SENT"), node(9000, "OPEN")] : [node(8000)];
    return { [draft ? "draftOrders" : "orders"]: { edges: nodes.map((node) => ({ node, cursor: "end" })), pageInfo: { hasNextPage: false } } };
  });
});

it("supports quarterly cards and counts completed quotes instead of dividing dollar amounts", async () => {
  const response = await GET(new NextRequest("https://example.test/api/kpi/metrics?employeeId=rob&department=sales&period=quarterly&date=2026-09-16&includeRecords=true"));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.employees[0].records.orders).toHaveLength(1);
  expect(result.employees[0].records.quotes).toHaveLength(2);
  expect(result.employees[0].records.orders[0].customerName).toBe("Avery Chen");
  expect(result.employees[0].records.quotes[0].customerName).toBe("Avery Chen");
  expect(result.employees[0].records.orders[0].url).toContain("rf-test.myshopify.com/admin/orders/");
  expect(result.dateRange.current).toEqual({ from: "2026-07-01", to: "2026-10-01" });
  expect(result.employees[0].metrics.current).toMatchObject({ quoted: 2000, quote_count: 2, sold: 8000, orders: 1, conversion_rate: 50 });
});

it("returns an error when Shopify fails", async () => {
  vi.mocked(shopifyGraphQL).mockRejectedValue(new Error("Unavailable"));
  const response = await GET(new NextRequest("https://example.test/api/kpi/metrics?employeeId=rob&period=monthly&date=2026-09-16"));
  expect(response.status).toBe(502);
  expect(await response.json()).toHaveProperty("error");
});
