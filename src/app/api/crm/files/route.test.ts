import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), from: vi.fn(), signed: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: mocks.from, storage: { from: () => ({ createSignedUrl: mocks.signed }) } }) }));
import { GET } from "./route";
const request = () => new Request("https://tools.rftransparent.ca/api/crm/files?id=hubspot:1:file:2");
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "rep@example.com" }); mocks.access.mockResolvedValue(true); });
describe("CRM attachment downloads", () => {
  it("authorizes before creating a private download link", async () => {
    mocks.user.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
    mocks.user.mockResolvedValue({ email: "staff@example.com" }); mocks.access.mockResolvedValue(false); expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("serves only verified copied assets using an expiring forced download", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { filename: "drawing.pdf", storage_path: "private/path" } })) };
    mocks.from.mockReturnValue(query); mocks.signed.mockResolvedValue({ data: { signedUrl: "https://storage.example/private?token=temporary" } });
    const response = await GET(request());
    expect(response.status).toBe(303); expect(query.eq).toHaveBeenCalledWith("status", "ready");
    expect(mocks.signed).toHaveBeenCalledWith("private/path", 60, { download: "drawing.pdf" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
