import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getAuthenticatedUserMock,
  isManagementUserMock,
  findEmployeeMock,
  getSupabaseMock,
  upsertMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(),
  isManagementUserMock: vi.fn(),
  findEmployeeMock: vi.fn(),
  getSupabaseMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  isManagementUser: isManagementUserMock,
}));
vi.mock("@/lib/employee-profile", () => ({
  findActiveEmployeeByEmail: findEmployeeMock,
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: getSupabaseMock }));

import { GET, POST } from "@/app/api/warehouse/reports/route";

function postRequest(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/warehouse/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUserMock.mockResolvedValue({ email: "worker@example.com" });
  isManagementUserMock.mockResolvedValue(false);
  findEmployeeMock.mockResolvedValue({
    id: "employee-self",
    name: "Warehouse Worker",
    department: "warehouse",
  });

  const single = vi.fn().mockResolvedValue({
    data: { id: "report-1", employee_id: "employee-self" },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  upsertMock.mockReturnValue({ select });
  // employees lookup used when a different name is selected on the shared form
  const employeeLookup = {
    select: vi.fn(() => employeeLookup),
    eq: vi.fn(() => employeeLookup),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "employee-other" }, error: null }),
  };
  getSupabaseMock.mockReturnValue({
    from: vi.fn((table: string) => table === "employees" ? employeeLookup : ({ upsert: upsertMock })),
  });
});

describe("frontline warehouse reports", () => {
  it("binds a report to the employee resolved from the authenticated email", async () => {
    const response = await POST(postRequest({
      report_date: "2026-08-13",
      boxes_built: 4,
      orders_packed: 5,
      walkin_pickup: 6,
      notes: null,
    }));

    expect(response.status).toBe(201);
    expect(findEmployeeMock).toHaveBeenCalledWith("worker@example.com");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "employee-self" }),
      { onConflict: "employee_id,report_date" },
    );
  });

  it("files for another warehouse employee selected on the shared station", async () => {
    const response = await POST(postRequest({
      report_date: "2026-08-13",
      boxes_built: 4,
      orders_packed: 5,
      walkin_pickup: 6,
      employee_id: "employee-other",
    }));

    expect(response.status).toBe(201);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "employee-other" }),
      { onConflict: "employee_id,report_date" },
    );
  });

  it("refuses a selected identity that is not an active warehouse employee", async () => {
    const employeeLookup = {
      select: vi.fn(() => employeeLookup),
      eq: vi.fn(() => employeeLookup),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    getSupabaseMock.mockReturnValue({
      from: vi.fn((table: string) => table === "employees" ? employeeLookup : ({ upsert: upsertMock })),
    });

    const response = await POST(postRequest({
      report_date: "2026-08-13",
      boxes_built: 4,
      orders_packed: 5,
      walkin_pickup: 6,
      employee_id: "employee-ghost",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That name is not an active warehouse employee",
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("requires management authorization for all-employee reporting", async () => {
    const request = new NextRequest(
      "https://tools.rftransparent.ca/api/warehouse/reports?scope=all",
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });
});
