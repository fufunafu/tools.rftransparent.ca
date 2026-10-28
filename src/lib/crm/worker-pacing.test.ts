import { afterEach, expect, it, vi } from "vitest";
import { createCrmPacer } from "./worker-pacing.mjs";
import { processCrmFollowups } from "./followups.mjs";
afterEach(() => vi.useRealTimers());
const db = (states: unknown[] = []) => ({ from: () => ({ select: async () => ({ data: states }) }), rpc: vi.fn(async () => ({ data: 0 })) });
it("honors another worker's cooldown and fails closed when backoff state is unavailable", async () => {
  const database = db([{ worker: "import", pause_until: new Date(Date.now() + 60000).toISOString(), batch_size: 4 }]);
  expect((await createCrmPacer(database, "index")).paused).toBe(true);
  expect(await processCrmFollowups(database)).toEqual({ processed: 0, complete: false, paused: true });
  expect(database.rpc).not.toHaveBeenCalled();
  expect((await createCrmPacer({ from: () => ({ select: async () => ({ error: { code: "network" } }) }) }, "index")).paused).toBe(true);
});
it("halves slow batches, stops on severe latency, and persists feedback", async () => {
  const database = db(); const pacer = await createCrmPacer(database, "index", 30);
  expect(pacer.batchSize).toBe(20); pacer.observe(2000); expect(pacer.batchSize).toBe(10); expect(pacer.paused).toBe(false);
  pacer.observe(6000); expect(pacer.batchSize).toBe(5); expect(pacer.paused).toBe(true);
  await pacer.finish(); expect(database.rpc).toHaveBeenCalledWith("crm_worker_feedback", { p_worker: "index", p_latency: 6000, p_failed: false });
});
it("retains a durable small batch on resume and increases it gradually after fast requests", async () => {
  const pacer = await createCrmPacer(db([{ worker: "index", pause_until: "2020-01-01", batch_size: 2 }]), "index", 30);
  expect(pacer.batchSize).toBe(2); pacer.observe(100); expect(pacer.batchSize).toBe(4);
});
