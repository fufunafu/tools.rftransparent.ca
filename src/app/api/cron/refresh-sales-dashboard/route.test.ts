import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automations", () => ({ withCronRun: (_name: string, handler: unknown) => handler }));
vi.mock("@/lib/sales-dashboard-snapshot", () => ({ refreshSalesDashboardSnapshot: refresh }));
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "test-secret"); });
it("rejects unauthenticated refreshes without touching sales", async () => {
  expect((await GET(new NextRequest("https://example.com/api/cron/refresh-sales-dashboard"))).status).toBe(401);
  expect(refresh).not.toHaveBeenCalled();
});
it("refreshes only for the authorized scheduler", async () => {
  refresh.mockResolvedValue({ status: "success", asOf: "2026-10-27T02:00:00Z" });
  const response = await GET(new NextRequest("https://example.com/api/cron/refresh-sales-dashboard", { headers: { authorization: "Bearer test-secret" } }));
  expect(await response.json()).toEqual({ status: "success", asOf: "2026-10-27T02:00:00Z" });
});
