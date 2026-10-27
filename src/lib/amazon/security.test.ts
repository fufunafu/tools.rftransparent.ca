import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), claims: vi.fn(), password: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mock.user, isAdminUser: mock.admin }));
vi.mock("@/lib/authz", () => ({ OWNER_EMAIL: "owner@example.com" }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseServerClient: async () => ({ auth: { getClaims: mock.claims } }) }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mock.password }) }) }) }) }));
import { amazonSecurityState, requireAmazonSecurity } from "./security";

beforeEach(() => {
  mock.user.mockResolvedValue({ id: "owner", email: "owner@example.com", factors: [{ factor_type: "totp", status: "verified" }] });
  mock.admin.mockResolvedValue(true);
  mock.claims.mockResolvedValue({ data: { claims: { sub: "owner", aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } }, error: null });
  mock.password.mockResolvedValue({ data: { verified_at: new Date(Date.now() - 1000).toISOString() }, error: null });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("requires both the staff role and the explicit Amazon approval", async () => {
  mock.admin.mockResolvedValue(false);
  await expect(requireAmazonSecurity()).rejects.toThrow("Admin access");
  mock.admin.mockResolvedValue(true);
  vi.stubEnv("AMAZON_APPROVED_USER_EMAILS", "someone-else@example.com");
  await expect(requireAmazonSecurity()).rejects.toThrow("not been approved");
});
it("requires verified claims matching the authenticated user", async () => {
  mock.claims.mockResolvedValue({ data: { claims: { sub: "attacker", aal: "aal2" } }, error: null });
  await expect(requireAmazonSecurity()).rejects.toThrow("Sign in again");
  mock.claims.mockResolvedValue({ data: null, error: new Error("bad signature") });
  await expect(requireAmazonSecurity()).rejects.toThrow("Sign in again");
});
it("does not trust a password login or an old MFA token after factor removal", async () => {
  mock.claims.mockResolvedValue({ data: { claims: { sub: "owner", aal: "aal1" } }, error: null });
  await expect(requireAmazonSecurity()).rejects.toThrow("Complete your Amazon security");
  mock.claims.mockResolvedValue({ data: { claims: { sub: "owner", aal: "aal2" } }, error: null });
  mock.user.mockResolvedValue({ id: "owner", email: "owner@example.com", factors: [] });
  await expect(requireAmazonSecurity()).rejects.toThrow("Complete your Amazon security");
});
it("fails closed when the compliance record is missing, expired, or unavailable", async () => {
  mock.password.mockResolvedValue({ data: null, error: null });
  await expect(requireAmazonSecurity()).rejects.toThrow("Complete your Amazon security");
  mock.password.mockResolvedValue({ data: { verified_at: "2020-01-01T00:00:00Z" }, error: null });
  await expect(requireAmazonSecurity()).rejects.toThrow("Complete your Amazon security");
  mock.password.mockResolvedValue({ data: null, error: new Error("missing table") });
  await expect(requireAmazonSecurity()).rejects.toThrow("not available");
});
it("allows only a current compliant password and an active verified MFA session", async () => {
  expect(await amazonSecurityState()).toMatchObject({ ready: true, mfaVerified: true, passwordCurrent: true, recentMfa: true });
});
