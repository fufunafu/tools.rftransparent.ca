import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isManagementUser: vi.fn(),
  getEmployeePerformance: vi.fn(),
  getPerformanceStoreOptions: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isManagementUser: mocks.isManagementUser,
}));

vi.mock("@/lib/employee-performance-data", () => ({
  getEmployeePerformance: mocks.getEmployeePerformance,
  getPerformanceStoreOptions: mocks.getPerformanceStoreOptions,
}));

import { GET } from "@/app/api/employees/performance/route";

function request(range = "7d", store = "store1") {
  return new NextRequest(
    `https://tools.rftransparent.ca/api/employees/performance?range=${range}&store=${store}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "manager@example.com" });
  mocks.isManagementUser.mockResolvedValue(true);
  mocks.getPerformanceStoreOptions.mockReturnValue([
    { id: "store1", label: "RF Transparent" },
    { id: "store3", label: "BC Transparent" },
  ]);
  mocks.getEmployeePerformance.mockResolvedValue({ range: "7d", employees: [] });
});

describe("GET /api/employees/performance", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.isManagementUser).not.toHaveBeenCalled();
    expect(mocks.getEmployeePerformance).not.toHaveBeenCalled();
  });

  it("rejects authenticated employees who are not managers", async () => {
    mocks.isManagementUser.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.getEmployeePerformance).not.toHaveBeenCalled();
  });

  it("returns performance data to managers", async () => {
    const response = await GET(request("30d"));

    expect(response.status).toBe(200);
    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("30d", "store1");
  });

  it("falls back to the seven-day range for unknown values", async () => {
    await GET(request("quarter"));

    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("7d", "store1");
  });

  it("scopes performance to the requested store", async () => {
    await GET(request("7d", "store3"));

    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("7d", "store3");
  });

  it("rejects an unknown store", async () => {
    const response = await GET(request("7d", "unknown"));

    expect(response.status).toBe(400);
    expect(mocks.getEmployeePerformance).not.toHaveBeenCalled();
  });

  it("returns a controlled error when the data query fails", async () => {
    mocks.getEmployeePerformance.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database unavailable" });
  });
});
