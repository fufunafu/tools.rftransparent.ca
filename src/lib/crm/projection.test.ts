import { afterEach, expect, it, vi } from "vitest";
import { processCrmProjections } from "./projection.mjs";
afterEach(() => vi.useRealTimers());
const from = (name: string) => ({ select: () => name === "crm_worker_backoff" ? Promise.resolve({ data: [] }) : { like: async () => ({ data: [] }) } });
const row = { record_id: "tools:contact", revision: 1, record: { source: "tools", object_type: "contacts", properties: { email: "client@example.com" } } };
it("pauses on a failed commit without advancing or repeatedly hammering the database", async () => {
  const rpc = vi.fn(async (name: string) => name === "crm_claim_projections" ? { data: [row] } : name === "crm_commit_projections" ? { error: { code: "57014" } } : { data: null });
  expect(await processCrmProjections({ rpc, from })).toEqual({ processed: 0, complete: false, paused: true, failed: true });
  expect(rpc.mock.calls.filter(([name]) => name === "crm_commit_projections")).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("crm_worker_feedback", expect.objectContaining({ p_worker: "index", p_failed: true }));
});
it("processes available work in bounded batches and stops once the queue is empty", async () => {
  vi.useFakeTimers(); let claims = 0;
  const rpc = vi.fn(async (name: string) => name === "crm_claim_projections" ? { data: ++claims === 1 ? [row] : [] } : name === "crm_commit_projections" ? { data: 1 } : { data: null });
  const run = processCrmProjections({ rpc, from }); await vi.runAllTimersAsync();
  expect(await run).toEqual({ processed: 1, complete: true });
  expect(rpc).toHaveBeenCalledWith("crm_claim_projections", expect.objectContaining({ p_limit: expect.any(Number) }));
});
