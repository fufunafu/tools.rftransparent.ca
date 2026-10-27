import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), list: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/crm/data", () => ({ listCrmRecords: mocks.list, getCrmStatus: mocks.status }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("@/components/crm/CrmWorkspace", () => ({ default: () => null }));
import Page from "./page";
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "Rep@example.com" }); mocks.access.mockResolvedValue(true); mocks.manage.mockResolvedValue(false); });
it("does not preload private records before authentication and department authorization", async () => {
  mocks.user.mockResolvedValue(null);
  await expect(Page()).rejects.toThrow("/login");
  mocks.user.mockResolvedValue({ email: "rep@example.com" }); mocks.access.mockResolvedValue(false);
  await expect(Page()).rejects.toThrow("/access-denied");
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
});
it("includes the first records and counts in the server response", async () => {
  const records = { records: [{ id: "sample" }], total: 1, page: 0 };
  const status = { counts: [], sync: null, configured: false };
  mocks.list.mockResolvedValue(records); mocks.status.mockResolvedValue(status);
  const page = await Page();
  expect(page.props).toMatchObject({ email: "rep@example.com", initialPage: records, initialStatus: status });
  expect(mocks.list).toHaveBeenCalledWith(expect.any(URLSearchParams), "rep@example.com");
});
it("leaves client retries available when a preload fails", async () => {
  mocks.list.mockRejectedValue(new Error("Temporary database issue")); mocks.status.mockRejectedValue(new Error("Temporary database issue"));
  const page = await Page();
  expect(page.props.initialPage).toBeUndefined(); expect(page.props.initialStatus).toBeUndefined();
});
