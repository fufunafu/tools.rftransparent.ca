import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/automations", () => ({ withCronRun: (_name: string, handler: unknown) => handler, SKIP_RUN_HISTORY_HEADER: "x-skip" }));
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCronRequest: mocks.auth }));
vi.mock("@/lib/crm/file-worker", () => ({ runCrmFileWorker: mocks.run }));
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); });
it("requires authorization before reading provider keys or copying files", async () => {
  mocks.auth.mockReturnValue(false); expect((await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-files"))).status).toBe(401); expect(mocks.run).not.toHaveBeenCalled();
});
it("reports partial worker failures without losing completed copies", async () => {
  mocks.auth.mockReturnValue(true); mocks.run.mockResolvedValue({ copied: 20, blocked: 1, failed: 0, workerErrors: 1 });
  const result = await GET(new NextRequest("https://tools.rftransparent.ca/api/cron/crm-files"));expect(result.status).toBe(503);expect(await result.json()).toMatchObject({ copied: 20 });
});
