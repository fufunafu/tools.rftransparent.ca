import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ graphql: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: m.db }) }));
vi.mock("@/lib/shopify", () => ({
  getStores: () => [{ id: "store1" }, { id: "store3" }], shopifyGraphQL: m.graphql,
  REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
}));
import { fetchSalesChanges, loadSalesMirror, salesSyncFilter, syncSalesShopifyMirror } from "./sales-shopify-mirror";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let remote: Record<string, Row[]>;
let failWrite: string | null;
function builder(table: string) {
  const predicates: Array<(row: Row) => boolean> = [];
  let slice: [number, number] | undefined;
  let orderBy: string | undefined;
  let single = false;
  let changes: Row | undefined;
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { predicates.push((row) => row[key] === value); return q; },
    is: (key: string, value: unknown) => { predicates.push((row) => row[key] === value); return q; },
    gte: (key: string, value: string) => { predicates.push((row) => String(row[key]) >= value); return q; },
    in: (key: string, values: unknown[]) => { predicates.push((row) => values.includes(row[key])); return q; },
    order: (key: string) => { orderBy = key; return q; },
    range: (from: number, to: number) => { slice = [from, to + 1]; return q; },
    maybeSingle: () => { single = true; return q; },
    update: (values: Row) => { changes = values; return q; },
    upsert: async (values: Row | Row[]) => {
      if (failWrite === table) return { error: { message: "write failed" } };
      for (const row of Array.isArray(values) ? values : [values]) {
        const prior = tables[table].find((r) => r.store_id === row.store_id && r.resource_type === row.resource_type && r.shopify_id === row.shopify_id);
        if (prior) Object.assign(prior, row); else tables[table].push({ ...row });
      }
      return { error: null };
    },
    then: (resolve: (result: unknown) => unknown) => {
      let rows = tables[table].filter((row) => predicates.every((check) => check(row)));
      if (orderBy) rows = rows.sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      if (slice) rows = rows.slice(...slice);
      if (changes) rows.forEach((row) => Object.assign(row, changes));
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    },
  };
  return q;
}
function record(id: string, updatedAt = "2026-10-25T12:00:00.000Z") {
  return { id, createdAt: "2026-09-01T12:00:00.000Z", updatedAt, tags: ["Rob"], customer: { firstName: "Avery", lastName: "Chen" } };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z")); failWrite = null;
  tables = {
    employees: ["Rob", "Daniel", "Craig", "Marie"].map((name) => ({ id: name.toLowerCase(), name, active: true, department: "sales", shopify_tags: [] })),
    sales_shopify_records: [], sales_shopify_sync_state: [],
  };
  remote = { "store1:order": [record("o1")], "store1:draft": [record("d1")], "store3:order": [record("o3")], "store3:draft": [record("d3")] };
  m.db.mockImplementation(builder);
  m.graphql.mockImplementation(async (storeId: string, query: string, vars: { filter?: string; ids?: string[] }) => {
    if (vars.ids) {
      const available = [...remote[`${storeId}:order`], ...remote[`${storeId}:draft`]].map((r) => r.id);
      return { nodes: vars.ids.map((id) => available.includes(id) ? { id } : null) };
    }
    const kind = query.includes("draftOrders(") ? "draft" : "order";
    const lower = vars.filter!.match(/updated_at:>='([^']+)'/)![1];
    const upper = vars.filter!.match(/updated_at:<='([^']+)'/)![1];
    const rows = remote[`${storeId}:${kind}`].filter((r) => String(r.updatedAt) >= lower && String(r.updatedAt) <= upper);
    return { [kind === "order" ? "orders" : "draftOrders"]: { edges: rows.map((node) => ({ node, cursor: node.id })), pageInfo: { hasNextPage: false } } };
  });
});
afterEach(() => vi.useRealTimers());

describe("incremental sales mirror", () => {
  it("imports history once, then requests only changes with an overlap and no rep-tag filter", async () => {
    expect(await syncSalesShopifyMirror()).toEqual({ recordsSynced: 4, deleted: 0, bootstrapped: 4 });
    m.graphql.mockClear(); vi.setSystemTime(new Date("2026-10-26T12:05:00Z"));
    expect(await syncSalesShopifyMirror()).toEqual({ recordsSynced: 0, deleted: 0, bootstrapped: 0 });
    const changes = m.graphql.mock.calls.filter((call) => call[2].filter);
    expect(changes).toHaveLength(4);
    for (const call of changes) {
      expect(call[2].filter).toBe("updated_at:>='2026-10-26T11:50:00.000Z' AND updated_at:<='2026-10-26T12:05:00.000Z'");
      expect(call[3]).toEqual({ rejectPartial: true });
    }
    expect(tables.sales_shopify_records).toHaveLength(4);
  });
  it("replaces changed records, including removed tags and refunds on older orders", async () => {
    await syncSalesShopifyMirror(); vi.setSystemTime(new Date("2026-10-26T12:05:00Z"));
    remote["store1:order"][0] = { ...record("o1", "2026-10-26T12:02:00.000Z"), createdAt: "2020-01-01T00:00:00Z", tags: [], transactions: [{ kind: "REFUND" }] };
    const result = await syncSalesShopifyMirror();
    expect(result.recordsSynced).toBe(1);
    const saved = await loadSalesMirror<Row>("store1", "order", new Date("2026-10-01"));
    expect(saved.nodes[0]).toMatchObject({ tags: [], transactions: [{ kind: "REFUND" }], createdAt: "2020-01-01T00:00:00Z" });
    expect(tables.sales_shopify_records).toHaveLength(4);
  });
  it("reconciles deleted quotes using IDs while retaining recoverable payloads", async () => {
    await syncSalesShopifyMirror(); remote["store1:draft"] = [];
    vi.setSystemTime(new Date("2026-10-26T12:05:00Z"));
    expect((await syncSalesShopifyMirror()).deleted).toBe(1);
    expect((await loadSalesMirror("store1", "draft", new Date("2026-09-01"))).nodes).toEqual([]);
    expect(tables.sales_shopify_records.find((r) => r.shopify_id === "d1")?.deleted_at).toBe("2026-10-26T12:05:00.000Z");
  });
  it("does not advance the cursor if writing changes fails", async () => {
    await syncSalesShopifyMirror(); const original = tables.sales_shopify_sync_state.find((r) => r.store_id === "store1" && r.resource_type === "order")!.last_synced_at;
    remote["store1:order"][0].updatedAt = "2026-10-26T12:02:00.000Z";
    vi.setSystemTime(new Date("2026-10-26T12:05:00Z")); failWrite = "sales_shopify_records";
    await expect(syncSalesShopifyMirror()).rejects.toThrow("Could not save");
    expect(tables.sales_shopify_sync_state.find((r) => r.store_id === "store1" && r.resource_type === "order")!.last_synced_at).toBe(original);
  });
  it("refuses incomplete pagination instead of silently marking history complete", async () => {
    m.graphql.mockResolvedValue({ orders: { edges: [], pageInfo: { hasNextPage: true } } });
    await expect(fetchSalesChanges("store1", "order", "test")).rejects.toThrow("pagination is incomplete");
  });
  it("does not silently fall back to full Shopify downloads when history is absent", async () => {
    await expect(loadSalesMirror("store1", "order", new Date("2026-09-01"))).rejects.toThrow("initial sync");
    expect(m.graphql).not.toHaveBeenCalled();
  });
  it("pages through all saved records while isolating stores and resource types", async () => {
    await syncSalesShopifyMirror();
    for (let i = 0; i < 510; i++) tables.sales_shopify_records.push({ store_id: "store1", resource_type: "order", shopify_id: `extra${i}`, shopify_updated_at: "2026-10-25T12:00:00Z", deleted_at: null, payload: record(`extra${i}`) });
    m.graphql.mockClear();
    expect((await loadSalesMirror("store1", "order", new Date("2026-10-01"))).nodes).toHaveLength(511);
    expect(m.graphql).not.toHaveBeenCalled();
  });
  it("reimports only when reporting coverage or the configured rep scope expands", () => {
    const state = { history_from: "2024-10-01T00:00:00Z", last_synced_at: "2026-10-26T12:00:00Z", bootstrap_scope: " AND (tag:\"marijac\")" };
    expect(salesSyncFilter(state, new Date("2024-11-01"), state.bootstrap_scope, new Date()).bootstrap).toBe(false);
    expect(salesSyncFilter(state, new Date("2024-09-01"), state.bootstrap_scope, new Date()).bootstrap).toBe(true);
    expect(salesSyncFilter(state, new Date("2024-11-01"), "", new Date()).bootstrap).toBe(true);
  });
});
