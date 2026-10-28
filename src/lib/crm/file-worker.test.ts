import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), delete: vi.fn(), eq: vi.fn(), lt: vi.fn(), insert: vi.fn(), copy: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => mocks }));
vi.mock("./assets.mjs", () => ({ migrateCrmAssets: mocks.copy }));
import { runCrmFileWorker } from "./file-worker";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("HUBSPOT_ACCESS_TOKEN", "test-token"); mocks.from.mockReturnValue(mocks); mocks.delete.mockReturnValue(mocks); mocks.eq.mockReturnValue(mocks); mocks.lt.mockResolvedValue({ error: null }); mocks.insert.mockResolvedValue({ error: null }); mocks.copy.mockResolvedValue({ copied: 2, blocked: 0, failed: 0 }); });
afterEach(() => vi.unstubAllEnvs());
it("skips another active server copy and never calls the file provider", async () => {
  mocks.insert.mockResolvedValue({ error: { code: "23505" } });
  expect(await runCrmFileWorker()).toHaveProperty("skipped"); expect(mocks.copy).not.toHaveBeenCalled();
});
it("stops after a file worker failure and releases only its own lease", async () => {
  mocks.copy.mockRejectedValueOnce(new Error("upstream detail"));
  expect(await runCrmFileWorker()).toEqual({ copied: 0, blocked: 0, failed: 0, workerErrors: 1 });
  const owner = mocks.insert.mock.calls[0][0].result.owner;
  expect(mocks.eq).toHaveBeenCalledWith("result->>owner", owner);
  expect(mocks.copy).toHaveBeenCalledTimes(1);
});

it("copies files sequentially and reports cooldown without starting parallel workers", async () => {
  mocks.copy.mockResolvedValue({ copied: 2, blocked: 0, failed: 0, paused: true });
  expect(await runCrmFileWorker()).toEqual({ copied: 2, blocked: 0, failed: 0, workerErrors: 0, paused: true });
  expect(mocks.copy).toHaveBeenCalledTimes(1);
});
