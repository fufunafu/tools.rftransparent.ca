import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  isManagementUser: vi.fn(),
  getSupabase: vi.fn(),
  employeeResult: {
    data: { id: "employee-target" } as Record<string, unknown> | null,
    error: null as { message: string } | null,
  },
  upsert: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isManagementUser: mocks.isManagementUser,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { POST } from "@/app/api/warehouse/reports/manage/route";

const report = {
  employee_id: "employee-target",
  report_date: "2026-08-13",
  boxes_built: 4,
  orders_packed: 5,
  walkin_pickup: 6,
  notes: "Manager correction",
};

function request(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/warehouse/reports/manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function employeeQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => mocks.employeeResult);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isManagementUser.mockResolvedValue(true);
  mocks.employeeResult = { data: { id: "employee-target" }, error: null };
  const single = vi.fn().mockResolvedValue({
    data: { id: "report-1", employee_id: "employee-target" },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  mocks.upsert.mockReturnValue({ select });
  mocks.getSupabase.mockReturnValue({
    from: vi.fn((table: string) =>
      table === "employees"
        ? employeeQuery()
        : { upsert: mocks.upsert },
    ),
  });
});

describe("management warehouse report corrections", () => {
  it("rejects a non-manager before reading or writing report data", async () => {
    mocks.isManagementUser.mockResolvedValue(false);

    const response = await POST(request(report));

    expect(response.status).toBe(403);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("uses the separately authorized endpoint to correct an active warehouse employee", async () => {
    const response = await POST(request(report));

    expect(response.status).toBe(201);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: "employee-target",
        report_date: "2026-08-13",
        boxes_built: 4,
        orders_packed: 5,
        walkin_pickup: 6,
      }),
      { onConflict: "employee_id,report_date" },
    );
  });

  it("refuses a correction for an employee outside the active warehouse roster", async () => {
    mocks.employeeResult = { data: null, error: null };

    const response = await POST(request(report));

    expect(response.status).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
