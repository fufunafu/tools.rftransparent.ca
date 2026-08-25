import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const DEFAULTS = {
  task_updates: true,
  overdue_updates: true,
  clock_reminders: true,
  followup_updates: true,
  callback_updates: true,
};

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getSupabase: vi.fn(),
  data: null as Record<string, boolean> | null,
  error: null as { message: string } | null,
  updates: [] as Array<Record<string, boolean>>,
  filters: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { GET, PATCH } from "@/app/api/push/preferences/route";

function query() {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"] as const) {
    builder[method] = vi.fn((...arguments_: unknown[]) => {
      mocks.filters.push([method, ...arguments_]);
      return builder;
    });
  }
  builder.update = vi.fn((payload: Record<string, boolean>) => {
    mocks.updates.push(payload);
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => ({ data: mocks.data, error: mocks.error }));
  return builder;
}

function patch(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/push/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "Worker@Example.com" });
  mocks.data = DEFAULTS;
  mocks.error = null;
  mocks.updates = [];
  mocks.filters = [];
  mocks.getSupabase.mockImplementation(() => ({ from: vi.fn(() => query()) }));
});

describe("per-device push preferences API", () => {
  it("requires authentication", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(new NextRequest(
      `https://tools.rftransparent.ca/api/push/preferences?token=${"A".repeat(64)}`,
    ));
    expect(response.status).toBe(401);
  });

  it("loads only a live token owned by the current user", async () => {
    const token = "A1".repeat(32);
    const response = await GET(new NextRequest(
      `https://tools.rftransparent.ca/api/push/preferences?token=${token}`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.filters).toContainEqual(["eq", "token", token]);
    expect(mocks.filters).toContainEqual(["eq", "user_email", "worker@example.com"]);
    expect(mocks.filters).toContainEqual(["is", "disabled_at", null]);
  });

  it("does not invent preferences for an unregistered or stale device token", async () => {
    mocks.data = null;
    const response = await GET(new NextRequest(
      `https://tools.rftransparent.ca/api/push/preferences?token=${"A1".repeat(32)}`,
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "This device is not registered",
    });
  });

  it("updates only recognized boolean preference fields", async () => {
    const token = "B2".repeat(32);
    mocks.data = { ...DEFAULTS, task_updates: false };
    const response = await PATCH(patch({
      token,
      task_updates: false,
      clock_reminders: "no",
      unexpected: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ task_updates: false }]);
    expect(mocks.filters).toContainEqual(["eq", "token", token]);
    expect(mocks.filters).toContainEqual(["eq", "user_email", "worker@example.com"]);
  });

  it("rejects a request with no valid preference", async () => {
    const response = await PATCH(patch({
      token: "C3".repeat(32),
      task_updates: "false",
    }));
    expect(response.status).toBe(400);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
  });
});
