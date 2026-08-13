import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { isAdminUserMock, getSupabaseMock } = vi.hoisted(() => ({
  isAdminUserMock: vi.fn(),
  getSupabaseMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isAuthenticated: vi.fn(),
  isAdminUser: isAdminUserMock,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: getSupabaseMock,
}));

import { POST } from "@/app/api/kpi/employees/route";
import { PUT } from "@/app/api/kpi/employees/[id]/route";

function employeeRequest(method: "POST" | "PUT", phone: string) {
  return new NextRequest("https://tools.example/api/kpi/employees", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alex", department: "sales", active: true, phone }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isAdminUserMock.mockResolvedValue(true);
});

describe("employee phone validation", () => {
  it("rejects an invalid phone before creating an employee", async () => {
    const response = await POST(employeeRequest("POST", "416-555-0123"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "phone" });
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone before updating an employee", async () => {
    const response = await PUT(
      employeeRequest("PUT", "invalid"),
      { params: Promise.resolve({ id: "employee-id" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "phone" });
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });
});
