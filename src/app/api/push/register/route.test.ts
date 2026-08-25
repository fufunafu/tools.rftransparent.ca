import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getSupabase: vi.fn(),
  employee: { id: "employee-1" } as { id: string } | null,
  employeeError: null as { message: string } | null,
  upsertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  upserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { DELETE, POST } from "@/app/api/push/register/route";

function query(table: string) {
  const value = table === "push_tokens"
    ? { error: mocks.updateError }
    : { error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "or", "eq"] as const) {
    builder[method] = vi.fn((...arguments_: unknown[]) => {
      mocks.filters.push([method, ...arguments_]);
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(async () => ({
    data: mocks.employee,
    error: mocks.employeeError,
  }));
  builder.upsert = vi.fn(async (payload: Record<string, unknown>) => {
    mocks.upserts.push(payload);
    return { error: mocks.upsertError };
  });
  builder.update = vi.fn((payload: Record<string, unknown>) => {
    mocks.updates.push(payload);
    return builder;
  });
  builder.then = (resolve: (result: typeof value) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(value).then(resolve, reject);
  return builder;
}

function post(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "Worker@Example.com" });
  mocks.employee = { id: "employee-1" };
  mocks.employeeError = null;
  mocks.upsertError = null;
  mocks.updateError = null;
  mocks.upserts = [];
  mocks.updates = [];
  mocks.filters = [];
  mocks.getSupabase.mockImplementation(() => ({
    from: vi.fn((table: string) => query(table)),
  }));
});

describe("push token registration API", () => {
  it("requires an authenticated employee session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await POST(post({
      token: "A".repeat(64),
      platform: "ios",
      apns_environment: "production",
    }));
    expect(response.status).toBe(401);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
  });

  it.each([123, "short", `${"A".repeat(40)}?`])(
    "rejects malformed token input %s without touching the database",
    async (token) => {
      const response = await POST(post({ token, apns_environment: "production" }));
      expect(response.status).toBe(400);
      expect(mocks.getSupabase).not.toHaveBeenCalled();
    },
  );

  it("reassigns a valid token to the current employee and APNs environment", async () => {
    const token = "A1".repeat(32);
    const response = await POST(post({
      token,
      platform: "ios",
      apns_environment: "sandbox",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ registered: true });
    expect(mocks.upserts).toEqual([expect.objectContaining({
      token,
      employee_id: "employee-1",
      user_email: "worker@example.com",
      platform: "ios",
      apns_environment: "sandbox",
      disabled_at: null,
    })]);
  });

  it("disables the prior device token after rotation even if the phone changed users", async () => {
    const previousToken = "C3".repeat(32);
    const token = "D4".repeat(32);
    const response = await POST(post({
      token,
      previous_token: previousToken,
      platform: "ios",
      apns_environment: "production",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.filters).toContainEqual(["eq", "token", previousToken]);
    expect(mocks.filters).not.toContainEqual(["eq", "user_email", "worker@example.com"]);
  });

  it("rejects a malformed prior token before touching the database", async () => {
    const response = await POST(post({
      token: "E5".repeat(32),
      previous_token: "not-valid",
      apns_environment: "production",
    }));

    expect(response.status).toBe(400);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
  });

  it("disables only the current user's registered token", async () => {
    const token = "B2".repeat(32);
    const response = await DELETE(new NextRequest(
      `https://tools.rftransparent.ca/api/push/register?token=${token}`,
      { method: "DELETE" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.filters).toContainEqual(["eq", "token", token]);
    expect(mocks.filters).toContainEqual(["eq", "user_email", "worker@example.com"]);
  });
});
