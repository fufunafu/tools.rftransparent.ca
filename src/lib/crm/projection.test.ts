import { afterEach, expect, it, vi } from "vitest";
import { processCrmProjections } from "./projection.mjs";
afterEach(() => vi.useRealTimers());
it("retries a failed projection commit with the same lease and does not lose the record", async () => {
  vi.useFakeTimers();
  let claims = 0, saves = 0;
  const rpc = vi.fn(async (name: string) => {
    if (name === "crm_claim_projections") return ++claims === 1 ? { error: { code: "57014" } } : claims === 2 ? { data: [{ record_id: "tools:contact", revision: 1, record: { source: "tools", object_type: "contacts", properties: { email: "client@example.com" } } }] } : { data: [] };
    return ++saves === 1 ? { error: { code: "40P01" } } : { data: 1 };
  });
  const db = { rpc, from: () => ({ select: () => ({ like: async () => ({ data: [] }) }) }) };
  const result = processCrmProjections(db, { budgetMs: 10000 });
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ processed: 1, complete: true });
  const commits = rpc.mock.calls.filter(([name]) => name === "crm_commit_projections");
  expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
});
