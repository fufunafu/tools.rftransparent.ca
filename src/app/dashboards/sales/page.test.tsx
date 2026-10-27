import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAuthenticated: m.auth }));
vi.mock("@/lib/sales-dashboard-snapshot", () => ({ readSalesDashboardSnapshot: m.read }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/components/admin/SalesManagerDashboard", () => ({ default: () => null }));
vi.mock("@/components/admin/AutoRefresh", () => ({ default: () => null }));
import Page from "./page";
beforeEach(() => { vi.resetAllMocks(); });
it("authenticates before reading saved sales data", async () => {
  m.auth.mockResolvedValue(false); m.redirect.mockImplementation(() => { throw new Error("redirect"); });
  await expect(Page()).rejects.toThrow("redirect");
  expect(m.redirect).toHaveBeenCalledWith("/login"); expect(m.read).not.toHaveBeenCalled();
});
it("passes all saved sections and the original date through to the unchanged table", async () => {
  m.auth.mockResolvedValue(true);
  const snapshot = { asOf: "2026-10-23T15:00:00Z", sales: { stores: [] }, customerService: { quotes: {} }, performers: { periods: {} }, followup: {} };
  m.read.mockResolvedValue(snapshot);
  const result = await Page();
  const props = result.props.children[1].props;
  for (const key of ["sales", "customerService", "performers", "followup"] as const) {
    expect(props[key]).toEqual({ ok: true, value: snapshot[key] });
  }
  expect(props.asOf).toBe(snapshot.asOf);
  expect(props.today).toContain("October 23");
});
