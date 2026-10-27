import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ graphql: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/shopify", () => ({ getStores: () => [{ id: "store1" }, { id: "store2" }], shopifyGraphQL: m.graphql }));
import { orderMonth, saveSalesOrders, syncPurchasingSales, type SalesOrder } from "./sales-sync";
import type { SalesLine } from "./sales-matching";
const line = (id: string): SalesLine => ({ id, sku: "SP-SS", title: "Spigot", variantTitle: "Stainless", currentQuantity: 4, quantity: 6, variant: null, product: null });
const order = (more = false): SalesOrder => ({ id: "order", createdAt: "2026-10-01T02:00:00Z", processedAt: "2026-10-01T02:00:00Z", updatedAt: "2026-10-27T12:00:00Z", test: false, cancelledAt: null, displayFinancialStatus: "PARTIALLY_REFUNDED", lineItems: { nodes: [line("one")], pageInfo: { hasNextPage: more, endCursor: more ? "items-next" : null } } });
let states: Record<string, Record<string, unknown>>;
let failStore: boolean;
let failLines: boolean;
let writes: Array<{ table: string; value: Record<string, unknown> }>;
beforeEach(() => {
  vi.clearAllMocks(); writes = []; failStore = false; failLines = false;
  states = Object.fromEntries(["store1", "store2"].map(id => [id, { store_id: id, timezone: "America/New_York", watermark: "2026-10-26T12:00:00Z", window_started_at: null, cursor: null, history_complete: true }]));
  m.from.mockImplementation((table: string) => {
    let id = ""; let update: Record<string, unknown> | null = null;
    const q = { select: () => q, eq: (key: string, value: string) => { if (key === "store_id") id = value; return q; }, single: () => q,
      update: (value: Record<string, unknown>) => { update = value; writes.push({ table, value }); return q; },
      upsert: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (update && states[id]) Object.assign(states[id], update);
        const data = table === "purchasing_products" ? [{ id: "product", sku: "SP-SS", name: "Spigot", category: "hardware", height: null, width: null }] : table === "purchasing_sales_state" ? { ...states[id] } : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      } };
    return q;
  });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.graphql.mockImplementation(async (store: string, query: string) => {
    if (store === "store2" && failStore) throw new Error("Store offline");
    if (query.includes("currentAppInstallation")) return { shop: { ianaTimezone: "America/New_York" }, currentAppInstallation: { accessScopes: [{ handle: "read_all_orders" }] } };
    if (query.includes("orders(first")) return { orders: { nodes: [order(true)], pageInfo: { hasNextPage: false, endCursor: null } } };
    if (failLines) throw new Error("Items unavailable");
    return { order: { lineItems: { nodes: [line("two")], pageInfo: { hasNextPage: false, endCursor: null } } } };
  });
});
describe("incremental purchasing sales import", () => {
  it("assigns order months in the store timezone, including midnight and DST boundaries", () => {
    expect(orderMonth("2026-10-01T02:00:00Z", "America/New_York")).toBe("2026-09-01");
    expect(orderMonth("2026-12-01T04:30:00Z", "America/New_York")).toBe("2026-11-01");
  });
  it("fetches every line-item page before saving and advances checkpoints after save", async () => {
    const result = await syncPurchasingSales();
    expect(result).toMatchObject({ published: true, stores: [{ store: "store1", orders: 1, complete: true }, { store: "store2", orders: 1, complete: true }] });
    const ingest = m.rpc.mock.calls.filter(c => c[0] === "purchasing_sales_ingest");
    expect(ingest).toHaveLength(2);
    expect(ingest[0][1].p_lines).toHaveLength(2);
    expect(ingest[0][1].p_lines[0]).toMatchObject({ quantity: 6, net_quantity: 4 });
    expect(ingest[0][1].p_orders[0]).toMatchObject({ month: "2026-09-01", excluded: false });
    expect(states.store1.window_started_at).toBeNull();
    expect(states.store1.watermark).not.toBe("2026-10-26T12:00:00Z");
  });
  it("does not save truncated orders or advance a failed import", async () => {
    failLines = true;
    const result = await syncPurchasingSales();
    expect(result).toMatchObject({ stores: [{ complete: false }, { complete: false }] });
    expect(m.rpc.mock.calls.filter(c => c[0] === "purchasing_sales_ingest")).toHaveLength(0);
    expect(states.store1.watermark).toBe("2026-10-26T12:00:00Z");
    expect(states.store1.last_error).toBe("Items unavailable");
    await expect(saveSalesOrders("store1", "America/New_York", [order(true)], [])).rejects.toThrow(/incomplete/);
  });
  it("records a failed store so the database publication gate retains the prior snapshot", async () => {
    failStore = true;
    const result = await syncPurchasingSales();
    expect(result).toMatchObject({ stores: [{ complete: true }, { complete: false, error: "Store offline" }] });
    expect(states.store2.last_error).toBe("Store offline");
    expect(states.store2.watermark).toBe("2026-10-26T12:00:00Z");
  });
  it("does no store work when another worker owns the lease", async () => {
    m.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await syncPurchasingSales()).toEqual({ skipped: "already_running" });
    expect(m.graphql).not.toHaveBeenCalled();
  });
});
