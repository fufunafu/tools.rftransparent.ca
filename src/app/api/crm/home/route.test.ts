import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), home: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/crm/home", () => ({ getCrmHome: mocks.home }));
import { GET } from "./route";
import { CrmInputError } from "@/lib/crm/input";
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "Rep@Example.com" }); mocks.access.mockResolvedValue(true); mocks.home.mockResolvedValue({ metrics: { contacts: 76 } }); });
it("checks authentication and CRM access before reading Home", async () => {
  mocks.user.mockResolvedValue(null); expect((await GET(new Request("https://tools.example/api/crm/home"))).status).toBe(401);
  mocks.user.mockResolvedValue({ email: "rep@example.com" }); mocks.access.mockResolvedValue(false);
  expect((await GET(new Request("https://tools.example/api/crm/home"))).status).toBe(403);
  expect(mocks.home).not.toHaveBeenCalled();
});
it("uses authenticated identity and private responses", async () => {
  const response = await GET(new Request("https://tools.example/api/crm/home?email=another@example.com&scope=mine"));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.home).toHaveBeenCalledWith("rep@example.com", expect.any(URLSearchParams));
});
it("returns input failures and hides internal database errors", async () => {
  mocks.home.mockRejectedValue(new CrmInputError("Invalid time zone")); expect((await GET(new Request("https://tools.example/api/crm/home"))).status).toBe(400);
  mocks.home.mockRejectedValue(new Error("private connection details")); const response = await GET(new Request("https://tools.example/api/crm/home"));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private connection");
});
