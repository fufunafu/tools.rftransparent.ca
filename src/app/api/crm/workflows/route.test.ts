import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { GET, POST } from "./route";
const request = (body: unknown, origin = "https://tools.rftransparent.ca") => new Request("https://tools.rftransparent.ca/api/crm/workflows", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "Rep@example.com" }); mocks.access.mockResolvedValue(true); mocks.manage.mockResolvedValue(false); mocks.rpc.mockResolvedValue({ data: [], error: null });
});
describe("CRM workflow access and mutations", () => {
  it.each(["status", "duplicates", "activity", "reminders", "files"])("gates the %s view before any data access", async view => {
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request(`https://tools.rftransparent.ca/api/crm/workflows?view=${view}`))).status).toBe(401);
    expect((await POST(request({}))).status).toBe(401);
    mocks.user.mockResolvedValue({ email: "user@example.com" }); mocks.access.mockResolvedValue(false);
    expect((await GET(new Request(`https://tools.rftransparent.ca/api/crm/workflows?view=${view}`))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and derives review attribution from the session", async () => {
    const review = { action: "review_duplicate", kind: "email", value: "client@example.com", fingerprint: "a".repeat(32), decision: "separate", actor: "spoof@example.com" };
    expect((await POST(request(review, "https://outside.example"))).status).toBe(403);
    expect((await POST(request(review))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("crm_review_duplicate", expect.objectContaining({ p_actor: "rep@example.com", p_decision: "separate" }));
  });
  it("reports stale review conflicts without exposing database details", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "private database detail" } });
    const response = await POST(request({ action: "review_duplicate", kind: "email", value: "client@example.com", fingerprint: "a".repeat(32), decision: "duplicate" }));
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
  it("allows only management to retry file imports", async () => {
    expect((await POST(request({ action: "retry_files" }))).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("bounds pagination and rejects malformed record references", async () => {
    for (const query of ["page=-1", "page=1.5", "page=999999", "view=files&record=unsafe"]) {
      expect((await GET(new Request(`https://tools.rftransparent.ca/api/crm/workflows?${query}`))).status).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("returns private responses for duplicate data", async () => {
    const response = await GET(new Request("https://tools.rftransparent.ca/api/crm/workflows?view=duplicates"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("crm_duplicate_groups", { p_reviewed: false, p_offset: 0 });
  });
});
