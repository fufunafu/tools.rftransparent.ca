import { describe, expect, it, vi } from "vitest";
import { commitCrmPage } from "./commit-page.mjs";

const records = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const payload = { p_portal: "123", p_token: "lease", p_records: records, p_links: records.map(record => ({ from_id: record.id, to_id: "contact" })), p_progress: { page: 2, count: 4 }, p_complete: true };
describe("resumable CRM page commits", () => {
  it("splits a timed-out transaction while advancing the checkpoint only after the final subset", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "57014" } }).mockResolvedValue({ error: null });
    await commitCrmPage({ rpc }, payload, { page: 1, count: 0 });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_records: records.slice(0, 2), p_links: payload.p_links.slice(0, 2), p_progress: { page: 1, count: 0 }, p_complete: false });
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_records: records.slice(2), p_links: payload.p_links.slice(2), p_progress: payload.p_progress, p_complete: true });
  });
  it("keeps the old checkpoint when a later subset fails so replay cannot skip records", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "57014" } }).mockResolvedValueOnce({ error: null }).mockResolvedValue({ error: { code: "connection" } });
    await expect(commitCrmPage({ rpc }, payload, { page: 1 })).rejects.toThrow("Saved pages are retained");
    expect(rpc.mock.calls[1][1].p_progress).toEqual({ page: 1 });
  });
  it("fails closed for a single record that cannot be saved", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "57014" } });
    await expect(commitCrmPage({ rpc }, { ...payload, p_records: records.slice(0, 1) }, { page: 1 })).rejects.toThrow("57014");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
