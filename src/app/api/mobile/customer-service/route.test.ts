import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  findEmployee: vi.fn(),
  getSupabase: vi.fn(),
  callbackResult: {
    data: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  },
  followupResult: {
    data: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  },
  assignmentResult: {
    data: { assigned_to: "worker@example.com" } as Record<string, unknown> | null,
    error: null as { code?: string; message: string } | null,
  },
  updates: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/employee-profile", () => ({
  findActiveEmployeeByEmail: mocks.findEmployee,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { GET, POST } from "@/app/api/mobile/customer-service/route";

function postRequest(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/mobile/customer-service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queueQuery(result: typeof mocks.callbackResult | typeof mocks.followupResult) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.or = vi.fn((value: string) => {
    mocks.filters.push(["or", value, null]);
    return query;
  });
  query.neq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.not = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(async () => result);
  return query;
}

function assignmentQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.update = vi.fn((value: Record<string, unknown>) => {
    mocks.updates.push(value);
    return query;
  });
  query.eq = vi.fn((field: string, value: unknown) => {
    mocks.filters.push(["eq", field, value]);
    return query;
  });
  query.is = vi.fn((field: string, value: unknown) => {
    mocks.filters.push(["is", field, value]);
    return query;
  });
  query.select = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => mocks.assignmentResult);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "Worker@Example.com" });
  mocks.findEmployee.mockResolvedValue({
    id: "employee-1",
    name: "Customer Service Worker",
    department: "customer_service",
  });
  mocks.callbackResult = { data: [], error: null };
  mocks.followupResult = { data: [], error: null };
  mocks.assignmentResult = { data: { assigned_to: "worker@example.com" }, error: null };
  mocks.updates = [];
  mocks.filters = [];
});

describe("mobile customer-service queue", () => {
  it("rejects a user outside the active customer-service roster before querying data", async () => {
    mocks.findEmployee.mockResolvedValue({
      id: "employee-1",
      name: "Sales Worker",
      department: "sales",
    });
    const from = vi.fn();
    mocks.getSupabase.mockReturnValue({ from });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("loads only work assigned to the viewer or still available", async () => {
    mocks.callbackResult = {
      data: [{ store_id: "rf_transparent", from_number: "5145550100", assigned_to: null }],
      error: null,
    };
    mocks.followupResult = {
      data: [{ id: "lead-1", assigned_to: "worker@example.com" }],
      error: null,
    };
    mocks.getSupabase.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "callback_notes"
          ? queueQuery(mocks.callbackResult)
          : queueQuery(mocks.followupResult),
      ),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      callbacks: mocks.callbackResult.data,
      followups: mocks.followupResult.data,
    });
    expect(mocks.filters.filter(([kind]) => kind === "or")).toEqual([
      ["or", 'assigned_to.eq."worker@example.com",assigned_to.is.null', null],
      ["or", 'assigned_to.eq."worker@example.com",assigned_to.is.null', null],
    ]);
  });

  it("claims a follow-up only while it is still unassigned", async () => {
    mocks.getSupabase.mockReturnValue({ from: vi.fn(() => assignmentQuery()) });

    const response = await POST(postRequest({
      type: "followup",
      action: "claim",
      id: "lead-1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ assigned_to: "worker@example.com" }]);
    expect(mocks.filters).toContainEqual(["eq", "id", "lead-1"]);
    expect(mocks.filters).toContainEqual(["is", "assigned_to", null]);
  });

  it("releases a follow-up only when it belongs to the viewer", async () => {
    mocks.getSupabase.mockReturnValue({ from: vi.fn(() => assignmentQuery()) });

    const response = await POST(postRequest({
      type: "followup",
      action: "release",
      id: "lead-1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ assigned_to: null }]);
    expect(mocks.filters).toContainEqual(["eq", "assigned_to", "worker@example.com"]);
  });

  it("reports a claim race instead of overwriting another assignment", async () => {
    mocks.assignmentResult = { data: null, error: null };
    mocks.getSupabase.mockReturnValue({ from: vi.fn(() => assignmentQuery()) });

    const response = await POST(postRequest({
      type: "followup",
      action: "claim",
      id: "lead-1",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Someone else already claimed this work.",
    });
  });
});
