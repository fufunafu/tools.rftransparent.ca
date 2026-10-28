import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), reminders: vi.fn(), projections: vi.fn(), capture: vi.fn(), assets: vi.fn() }));
vi.mock("@/lib/automations", () => ({ withCronRun: (_name: string, handler: unknown) => handler }));
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCronRequest: mocks.authorized }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
vi.mock("@/lib/crm/reminders", () => ({ sendCrmReminders: mocks.reminders }));
vi.mock("@/lib/crm/projection.mjs", () => ({ processCrmProjections: mocks.projections }));
vi.mock("@/lib/crm/capture", () => ({ captureCrmActivity: mocks.capture }));
vi.mock("@/lib/crm/assets.mjs", () => ({ migrateCrmAssets: mocks.assets }));
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); mocks.authorized.mockReturnValue(true); });
it("requires cron authorization before sending or capturing anything", async () => {
  mocks.authorized.mockReturnValue(false);
  expect((await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-workflows"))).status).toBe(401);
  expect(mocks.reminders).not.toHaveBeenCalled(); expect(mocks.projections).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.assets).not.toHaveBeenCalled();
});
it("continues independent work after a failed queue without disclosing provider details", async () => {
  mocks.projections.mockRejectedValue(new Error("private source detail"));
  const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-workflows"));
  expect(response.status).toBe(503); expect(mocks.reminders).toHaveBeenCalledOnce(); expect(mocks.capture).toHaveBeenCalledOnce(); expect(mocks.assets).not.toHaveBeenCalled();
  expect(JSON.stringify(await response.json())).not.toContain("private source detail");
});
it("records a failed run when the index worker reports a database error", async () => {
  mocks.projections.mockResolvedValue({ processed: 0, complete: false, paused: true, failed: true });
  expect((await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-workflows"))).status).toBe(503);
  mocks.projections.mockResolvedValue({ processed: 0, complete: false, paused: true });
  expect((await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-workflows"))).status).toBe(200);
});
