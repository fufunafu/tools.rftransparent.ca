import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isManagementUser: vi.fn(),
  getEmployeePerformance: vi.fn(),
  getPerformanceLocationOptions: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isManagementUser: mocks.isManagementUser,
}));

vi.mock("@/lib/employee-performance-data", () => ({
  getEmployeePerformance: mocks.getEmployeePerformance,
  getPerformanceLocationOptions: mocks.getPerformanceLocationOptions,
}));

import { GET } from "@/app/api/employees/performance/route";

const LOCATIONS = [
  { id: "laval", name: "BC - Laval", shopifyStoreIds: ["store3"] },
  { id: "toronto", name: "RF/GRS - Toronto", shopifyStoreIds: ["store1", "store2"] },
];

function request(range = "7d", location = "laval") {
  return new NextRequest(
    `https://tools.rftransparent.ca/api/employees/performance?range=${range}&location=${location}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "manager@example.com" });
  mocks.isManagementUser.mockResolvedValue(true);
  mocks.getPerformanceLocationOptions.mockResolvedValue(LOCATIONS);
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
    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("30d", "laval", LOCATIONS);
  });

  it("falls back to the seven-day range for unknown values", async () => {
    await GET(request("quarter"));

    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("7d", "laval", LOCATIONS);
  });

  it("scopes performance to the requested location", async () => {
    await GET(request("7d", "toronto"));

    expect(mocks.getEmployeePerformance).toHaveBeenCalledWith("7d", "toronto", LOCATIONS);
  });

  it("rejects an unknown location", async () => {
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
