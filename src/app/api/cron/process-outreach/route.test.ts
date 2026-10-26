import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), config: vi.fn(), process: vi.fn(), mail: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ isAuthorizedCronRequest: mocks.authorized }));
vi.mock("@/lib/automations", () => ({ withCronRun: (_job: string, handler: unknown) => handler, SKIP_RUN_HISTORY_HEADER: "x-skip-run-history" }));
vi.mock("@/lib/outreach/domain", () => ({ getOutreachConfig: mocks.config }));
vi.mock("@/lib/outreach/service", () => ({ processOutreachEvents: mocks.process }));
vi.mock("@/lib/outreach/staff-mail", () => ({ syncOutreachStaffMail: mocks.mail }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.mail.mockResolvedValue({checked:0,synced:0,errors:0}); mocks.authorized.mockReturnValue(true); mocks.config.mockReturnValue({}); vi.stubEnv("OUTREACH_WORKER_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());
describe("outreach processor entry point", () => {
  it("requires cron authentication", async () => { mocks.authorized.mockReturnValue(false); expect((await GET(new NextRequest("https://tools.example/api/cron/process-outreach"))).status).toBe(401); expect(mocks.process).not.toHaveBeenCalled(); });
  it("does no work while disabled", async () => { vi.stubEnv("OUTREACH_WORKER_ENABLED", "false"); const response = await GET(new NextRequest("https://tools.example/api/cron/process-outreach")); expect(response.headers.get("x-skip-run-history")).toBe("true"); expect(mocks.process).not.toHaveBeenCalled(); });
  it("reports soft processing failures as failures", async () => { mocks.process.mockResolvedValue({ claimed: 1, errors: 1 }); expect((await GET(new NextRequest("https://tools.example/api/cron/process-outreach"))).status).toBe(502); });
});
