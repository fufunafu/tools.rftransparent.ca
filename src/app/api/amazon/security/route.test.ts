import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ state: vi.fn(), update: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/amazon/security", () => ({ amazonSecurityState: mock.state }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => ({ auth: { updateUser: mock.update } }) }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: mock.confirm }) }));
import { AmazonError } from "@/lib/amazon/domain";
import { GET, POST } from "./route";
const password = "New Strong Pass 48!";
const request = (body: unknown, origin = "https://tools.rftransparent.ca") => new Request("https://tools.rftransparent.ca/api/amazon/security", {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  mock.state.mockResolvedValue({ userId: "owner", mfaVerified: true, recentMfa: true, passwordCurrent: false, passwordExpiresAt: null, ready: false });
  mock.update.mockResolvedValue({ data: { user: { id: "owner", updated_at: "2026-10-03T19:00:00Z" } }, error: null });
  mock.confirm.mockResolvedValue({ data: true, error: null });
});
afterEach(() => { vi.resetAllMocks(); });

it("returns only security status and prevents caching", async () => {
  const response = await GET();
  expect(await response.json()).not.toHaveProperty("userId");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects unauthenticated users, CSRF, and stale MFA before changing a password", async () => {
  expect((await POST(request({ password }, "https://attacker.example"))).status).toBe(403);
  mock.state.mockRejectedValueOnce(new AmazonError("Forbidden", 403));
  expect((await POST(request({ password }))).status).toBe(403);
  mock.state.mockResolvedValue({ mfaVerified: true, recentMfa: false });
  expect((await POST(request({ password }))).status).toBe(403);
  expect(mock.update).not.toHaveBeenCalled();
});
it("rejects weak, unchanged, and oversized passwords before the identity provider", async () => {
  expect((await POST(request({ password: "weak" }))).status).toBe(400);
  expect((await POST(request({ password, currentPassword: password }))).status).toBe(400);
  expect((await POST(request({ password: "a".repeat(5000) }))).status).toBe(413);
  expect(mock.update).not.toHaveBeenCalled();
});
it("does not certify a failed password update or leak provider responses", async () => {
  mock.update.mockResolvedValue({ data: null, error: { message: "secret-token", code: "bad_password" } });
  const response = await POST(request({ password }));
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("secret-token");
  expect(mock.confirm).not.toHaveBeenCalled();
});
it("binds certification to the authenticated user and exact successful Auth revision", async () => {
  expect((await POST(request({ password }))).status).toBe(200);
  expect(mock.confirm).toHaveBeenCalledWith("confirm_amazon_password", { p_user_id: "owner", p_auth_updated_at: "2026-10-03T19:00:00Z" });
});
it("reports failure when a concurrent reset prevents certification", async () => {
  mock.confirm.mockResolvedValue({ data: false, error: null });
  expect((await POST(request({ password }))).status).toBe(503);
});
