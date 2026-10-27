import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  read: vi.fn(), insert: vi.fn(), upsert: vi.fn(), cleanup: vi.fn(), release: vi.fn(),
  sales: vi.fn(), cs: vi.fn(), team: vi.fn(), followup: vi.fn(), targets: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: m.read }) }),
  insert: m.insert, upsert: m.upsert,
  delete: () => ({ eq: () => ({ lt: m.cleanup, eq: m.release }) }),
}) }) }));
vi.mock("@/lib/shopify", () => ({ getStores: () => [{ id: "store1" }] }));
vi.mock("@/lib/settings", () => ({ getSalesTargets: m.targets }));
vi.mock("@/lib/sales-shopify-mirror", () => ({ syncSalesShopifyMirror: async () => ({ recordsSynced: 0, deleted: 0, bootstrapped: 0 }) }));
vi.mock("@/lib/ops-dashboard", () => ({
  getSalesByStore: m.sales, getCustomerServiceOps: m.cs,
  getSalesTeamOverview: m.team, getFollowupOverview: m.followup,
}));
import { readSalesDashboardSnapshot, refreshSalesDashboardSnapshot, SALES_SNAPSHOT_KEY } from "./sales-dashboard-snapshot";

const values = () => ({
  asOf: "2026-10-23T12:00:00.000Z",
  sales: { stores: [{ id: "store1", target: 100 }], failedStores: [], warnings: [] },
  customerService: { warnings: [], quotes: { warnings: [] } },
  performers: { periods: { "7d": [], "30d": [], "90d": [], "180d": [], "1y": [] }, warnings: [] },
  followup: { dueToday: 2 },
});
beforeEach(() => {
  vi.resetAllMocks(); vi.useRealTimers();
  m.targets.mockResolvedValue({ store1: 200 });
  m.cleanup.mockResolvedValue({ error: null }); m.release.mockResolvedValue({ error: null });
  m.insert.mockResolvedValue({ error: null }); m.upsert.mockResolvedValue({ error: null });
  const v = values();
  m.sales.mockResolvedValue({ ok: true, value: v.sales });
  m.cs.mockResolvedValue({ ok: true, value: v.customerService });
  m.team.mockResolvedValue({ ok: true, value: v.performers });
  m.followup.mockResolvedValue({ ok: true, value: v.followup });
});

describe("sales dashboard snapshot", () => {
  it("serves a saved dashboard after a quiet weekend without downloading history, with current targets", async () => {
    m.read.mockResolvedValue({ data: { result: values() }, error: null });
    const result = await readSalesDashboardSnapshot();
    expect(result?.asOf).toBe(values().asOf);
    expect(result?.sales.stores[0].target).toBe(200);
    expect(result?.performers.periods).toEqual(values().performers.periods);
    expect(m.sales).not.toHaveBeenCalled(); expect(m.team).not.toHaveBeenCalled();
  });
  it("does not start a slow live computation when the snapshot is missing", async () => {
    m.read.mockResolvedValue({ data: null, error: null });
    expect(await readSalesDashboardSnapshot()).toBeNull();
    expect(m.team).not.toHaveBeenCalled();
  });
  it("reports storage failure instead of serving invented totals", async () => {
    m.read.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(readSalesDashboardSnapshot()).rejects.toThrow("Could not read");
  });
  it("forces fresh calculations and publishes all five periods together", async () => {
    expect((await refreshSalesDashboardSnapshot()).status).toBe("success");
    expect(m.sales).toHaveBeenCalledWith({ forceRefresh: true });
    expect(m.cs).toHaveBeenCalledWith(undefined, { forceRefresh: true });
    expect(m.team).toHaveBeenCalledWith({ forceRefresh: true, fromMirror: true });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ cache_key: SALES_SNAPSHOT_KEY, result: expect.objectContaining({ performers: values().performers }) }));
    expect(m.release).toHaveBeenCalledWith("result->>owner", expect.any(String));
  });
  it("skips concurrent refreshes across instances", async () => {
    m.insert.mockResolvedValue({ error: { code: "23505" } });
    expect(await refreshSalesDashboardSnapshot()).toEqual({ status: "skipped" });
    expect(m.team).not.toHaveBeenCalled(); expect(m.release).not.toHaveBeenCalled();
  });
  it("retains the last complete snapshot if Shopify fails", async () => {
    m.team.mockResolvedValue({ ok: false, error: "Shopify unavailable" });
    await expect(refreshSalesDashboardSnapshot()).rejects.toThrow("Keeping the previous");
    expect(m.upsert).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalled();
  });
  it("rejects partial source results rather than turning missing revenue into zero", async () => {
    m.sales.mockResolvedValue({ ok: true, value: { ...values().sales, failedStores: ["store1"] } });
    await expect(refreshSalesDashboardSnapshot()).rejects.toThrow("incomplete source data");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("preserves intentional attribution exclusions and their visible warning", async () => {
    const performers = { ...values().performers, warnings: ["1 sales record matched multiple reps and were excluded"] };
    m.team.mockResolvedValue({ ok: true, value: performers });
    expect((await refreshSalesDashboardSnapshot()).status).toBe("success");
    expect(m.upsert.mock.calls[0][0].result.performers.warnings).toEqual(performers.warnings);
  });
  it("does not publish incomplete performer downloads", async () => {
    m.team.mockResolvedValue({ ok: true, value: { ...values().performers, warnings: ["RF performer orders are unavailable"] } });
    await expect(refreshSalesDashboardSnapshot()).rejects.toThrow("incomplete source data");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("does not publish mixed date windows when a refresh crosses midnight", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T03:59:00Z"));
    m.team.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-10-27T04:01:00Z"));
      return { ok: true, value: values().performers };
    });
    await expect(refreshSalesDashboardSnapshot()).rejects.toThrow("crossed midnight");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("reports failed writes and releases its lease for retry", async () => {
    m.upsert.mockResolvedValue({ error: { message: "down" } });
    await expect(refreshSalesDashboardSnapshot()).rejects.toThrow("Could not save");
    expect(m.release).toHaveBeenCalled();
  });
});
