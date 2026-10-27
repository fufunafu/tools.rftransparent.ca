import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), manage: vi.fn(), employee: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/employee-profile", () => ({ findActiveEmployeeByEmail: mocks.employee }));
import { canAccessCrm } from "./access";
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "staff@example.com" }); mocks.manage.mockResolvedValue(false); });
describe("CRM department access", () => {
  it.each(["sales", "customer_service"])("allows active %s staff", async department => {
    mocks.employee.mockResolvedValue({ department }); expect(await canAccessCrm()).toBe(true);
  });
  it("allows management without a separate employee profile", async () => {
    mocks.manage.mockResolvedValue(true); expect(await canAccessCrm()).toBe(true);
  });
  it.each(["warehouse", "accounting", null])("denies unapproved or inactive staff: %s", async department => {
    mocks.employee.mockResolvedValue(department ? { department } : null); expect(await canAccessCrm()).toBe(false);
  });
  it("fails closed when the employee lookup fails", async () => {
    mocks.employee.mockRejectedValue(new Error("Database unavailable")); expect(await canAccessCrm()).toBe(false);
  });
});
