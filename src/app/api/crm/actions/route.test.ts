import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
import { POST } from "./route";

const note = "tools:11111111-1111-4111-8111-111111111111", contact = "hubspot:1:contacts:2", company = "hubspot:1:companies:3";
const request = (body: unknown, origin = "https://tools.rftransparent.ca") => new Request("https://tools.rftransparent.ca/api/crm/actions", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "Rep@Example.com" }); mocks.access.mockResolvedValue(true); mocks.manage.mockResolvedValue(false);
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
});

describe("CRM record actions", () => {
  it("requires sign-in and CRM access before touching the database", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request({ action: "delete", id: note, version: 1 }))).status).toBe(401);
    mocks.user.mockResolvedValue({ email: "warehouse@example.com" }); mocks.access.mockResolvedValue(false);
    expect((await POST(request({ action: "delete", id: note, version: 1 }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and unknown fields", async () => {
    expect((await POST(request({ action: "delete", id: note, version: 1 }, "https://outside.example"))).status).toBe(403);
    expect((await POST(request({ action: "delete", id: note, version: 1, actor: "boss@example.com" }))).status).toBe(400);
    expect((await POST(request({ action: "editActivity", id: note, version: 1, title: "Call", body: "", occurredAt: "2026-10-27T12:00:00Z", details: { call_outcome: "teleported" } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("takes the actor and management rights from the session", async () => {
    mocks.manage.mockResolvedValue(true);
    const response = await POST(request({ action: "editActivity", id: note, version: 1, title: " Call back ", body: "Left a message", occurredAt: "2026-10-27T12:00:00Z", details: { call_outcome: "voicemail", duration_minutes: "3" } }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("crm_edit_activity", expect.objectContaining({ p_actor: "rep@example.com", p_can_manage: true, p_title: "Call back", p_details: { call_outcome: "voicemail", duration_minutes: "3" } }));
  });
  it("passes task reassignment, deletes, pins and associations to their database functions", async () => {
    await POST(request({ action: "editTask", id: note, version: 1, title: "Send quote", body: "", ownerEmail: "Other@Example.com", details: { priority: "high" } }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_update_task_details", expect.objectContaining({ p_owner: "other@example.com", p_details: { priority: "high" }, p_can_manage: false }));
    await POST(request({ action: "editTask", id: note, version: 1, title: "Send quote", body: "", details: { priority: "" } }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_update_task_details", expect.objectContaining({ p_owner: null, p_details: { priority: "" } }));
    await POST(request({ action: "restore", id: note, version: 2 }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_set_deleted", expect.objectContaining({ p_deleted: false, p_version: 2 }));
    await POST(request({ action: "pin", recordId: contact, activityId: null }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_pin_activity", { p_record: contact, p_activity: null, p_actor: "rep@example.com" });
    await POST(request({ action: "unlink", fromId: contact, toId: company }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("crm_unlink_records", { p_from: contact, p_to: company, p_actor: "rep@example.com" });
  });
  it("returns the database's own permission message, hides unexpected details, and flags a missing update", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Only the creator or management may delete this record" } });
    const denied = await POST(request({ action: "delete", id: contact, version: 1 }));
    expect(denied.status).toBe(403); expect((await denied.json()).error).toBe("Only the creator or management may delete this record");
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "relation crm_secret_table column xyz" } });
    const hidden = await POST(request({ action: "delete", id: contact, version: 1 }));
    expect(hidden.status).toBe(409); expect(JSON.stringify(await hidden.json())).not.toContain("crm_secret_table");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const missing = await POST(request({ action: "link", fromId: contact, toId: company }));
    expect(missing.status).toBe(503); expect((await missing.json()).error).toContain("database update");
  });
});
