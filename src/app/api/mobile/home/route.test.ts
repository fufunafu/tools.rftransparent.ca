import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  findEmployee: vi.fn(),
  getSupabase: vi.fn(),
  tasksResult: { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null },
  clockResult: { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null },
  openResult: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
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

import { GET } from "@/app/api/mobile/home/route";

const NOW = new Date("2026-08-13T18:00:00.000Z");

function todosQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.limit = vi.fn(async () => mocks.tasksResult);
  return query;
}

function timeEntriesQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.order = vi.fn(async () => mocks.clockResult);
  query.maybeSingle = vi.fn(async () => mocks.openResult);
  return query;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "worker@example.com" });
  mocks.findEmployee.mockResolvedValue({
    id: "employee-1",
    name: "Jordan Employee",
    department: "warehouse",
    location: { id: "location-1", name: "Toronto" },
  });
  mocks.tasksResult = {
    data: [
      { due_at: "2026-08-12" },
      { due_at: "2026-08-13" },
      { due_at: null },
    ],
    error: null,
  };
  mocks.clockResult = {
    data: [{
      id: "closed",
      clock_in_at: "2026-08-13T12:00:00.000Z",
      clock_out_at: "2026-08-13T14:00:00.000Z",
      flagged: false,
    }],
    error: null,
  };
  mocks.openResult = {
    data: {
      id: "open",
      clock_in_at: "2026-08-13T17:00:00.000Z",
      clock_out_at: null,
      flagged: false,
    },
    error: null,
  };
  mocks.getSupabase.mockReturnValue({
    from: vi.fn((table: string) => table === "todos" ? todosQuery() : timeEntriesQuery()),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/mobile/home", () => {
  it("aggregates profile, clock, task exceptions, and role work in one response", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      profile: {
        id: "employee-1",
        name: "Jordan Employee",
        department: "warehouse",
        locationName: "Toronto",
      },
      clock: {
        linked: true,
        open: { id: "open", stale: false },
        weekMinutes: 180,
      },
      tasks: { active: 3, dueToday: 1, overdue: 1 },
    });
    expect(body.roleActions[0]).toMatchObject({
      id: "warehouse-report",
      href: "/warehouse/report",
    });
    expect(mocks.findEmployee).toHaveBeenCalledWith("worker@example.com");
  });

  it("returns an explicit unlinked state without querying time entries", async () => {
    mocks.findEmployee.mockResolvedValue(null);
    const from = vi.fn((table: string) => {
      if (table !== "todos") throw new Error("time entries should not be queried");
      return todosQuery();
    });
    mocks.getSupabase.mockReturnValue({ from });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: null,
      clock: { linked: false, open: null, weekMinutes: 0 },
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.findEmployee).not.toHaveBeenCalled();
  });

  it("returns a stable unavailable state when an aggregation source fails", async () => {
    mocks.tasksResult = { data: [], error: { message: "database unavailable" } };
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Your daily view is temporarily unavailable.",
    });
  });
});
