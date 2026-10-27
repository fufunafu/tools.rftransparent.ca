import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn(), access: vi.fn(), record: vi.fn(), rpc: vi.fn(), list: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/crm/data", () => ({ getCrmRecord: mocks.record, listCrmRecords: mocks.list, getCrmStatus: mocks.status }));
import { GET, POST, PATCH } from "./route";
const request = (body: unknown, method = "POST", origin = "https://tools.rftransparent.ca") => new Request("https://tools.rftransparent.ca/api/crm", { method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const task = { id: "hubspot:40088916:tasks:11", version: 1, status: "completed", dueAt: "2026-11-01T10:00:00Z" };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "rep@example.com" }); mocks.manage.mockResolvedValue(false); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: "tools:123", error: null }); });

describe("CRM routes", () => {
  it.each(["detail", "fields", "history"])("authorizes and forwards the on-demand %s view", async view => {
    mocks.record.mockResolvedValue({ id: task.id });
    const response = await GET(new Request(`https://tools.rftransparent.ca/api/crm?id=${task.id}&view=${view}`));
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledWith(task.id, view);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects unknown projections before reading the record", async () => {
    const response = await GET(new Request(`https://tools.rftransparent.ca/api/crm?id=${task.id}&view=private`));
    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("streams large record histories completely in bounded chunks after authorization", async () => {
    const record = { id: "hubspot:40088916:emails:1", properties: { text: "Montréal 客户 ".repeat(400_000) }, property_history: { previous: ["retained"] } };
    mocks.record.mockResolvedValue(record);
    const response = await GET(new Request(`https://tools.rftransparent.ca/api/crm?id=${record.id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const expected = new TextEncoder().encode(JSON.stringify(record));
    expect(expected.byteLength).toBeGreaterThan(4_500_000);
    const reader = response.body!.getReader();
    const hash = createHash("sha256");
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      expect(value.byteLength).toBeLessThanOrEqual(64 * 1024);
      received += value.byteLength;
      hash.update(value);
    }
    expect(received).toBe(expected.byteLength);
    expect(hash.digest("hex")).toBe(createHash("sha256").update(expected).digest("hex"));
  });
  it("denies authenticated employees outside the approved departments", async () => {
    mocks.access.mockResolvedValue(false);
    expect((await GET(new Request("https://tools.rftransparent.ca/api/crm"))).status).toBe(403);
    expect((await POST(request({}))).status).toBe(403);
    expect((await PATCH(request(task, "PATCH"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("protects all reads and writes even without proxy", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request("https://tools.rftransparent.ca/api/crm"))).status).toBe(401);
    expect((await POST(request({}))).status).toBe(401);
    expect((await PATCH(request(task, "PATCH"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations and malformed scheduling", async () => {
    expect((await POST(request({}, "POST", "https://outside.example"))).status).toBe(403);
    expect((await POST(request({ type: "tasks", title: "Follow up" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("derives the author from the session and writes only to Tools", async () => {
    const response = await POST(request({ requestId: "11111111-1111-4111-8111-111111111111", type: "tasks", title: "Follow up", occurredAt: "2026-10-27T10:00:00Z", dueAt: "2026-11-01T10:00:00Z", relatedId: null, actor: "other@example.com" }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("crm_create_record", expect.objectContaining({ p_actor: "rep@example.com", p_type: "tasks" }));
  });
  it("refuses task edits from another employee", async () => {
    mocks.record.mockResolvedValue({ owner_email: "other@example.com" });
    expect((await PATCH(request(task, "PATCH"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes optimistic versions and reports conflicts", async () => {
    mocks.record.mockResolvedValue({ owner_email: "rep@example.com" });
    mocks.rpc.mockResolvedValue({ error: { message: "stale" } });
    expect((await PATCH(request(task, "PATCH"))).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith("crm_update_task", expect.objectContaining({ p_version: 1, p_can_manage: false }));
  });
});
