import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getSupabase: vi.fn(),
  employee: null as Record<string, unknown> | null,
  employeeError: null as { message: string } | null,
  openResults: [] as Array<{ data: Record<string, unknown> | null; error: { message: string } | null }>,
  weekEntries: [] as Array<Record<string, unknown>>,
  weekError: null as { message: string } | null,
  insertResult: { error: null as { code?: string; message: string } | null },
  updateResult: { data: { id: "shift" } as Record<string, unknown> | null, error: null as { message: string } | null },
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import { POST } from "@/app/api/clock/route";

const NOW = new Date("2026-08-13T18:00:00.000Z");
const LOCATION = {
  name: "Toronto",
  latitude: 43.65,
  longitude: -79.38,
  clock_in_radius_m: 100,
};

function employeeQuery() {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.or = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({
    data: mocks.employee,
    error: mocks.employeeError,
  }));
  return query;
}

function timeEntriesQuery() {
  let mode: "select" | "update" = "select";
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.is = vi.fn(() => query);
  query.gte = vi.fn(() => query);
  query.order = vi.fn(async () => ({ data: mocks.weekEntries, error: mocks.weekError }));
  query.insert = vi.fn(async (value: Record<string, unknown>) => {
    mocks.inserts.push(value);
    return mocks.insertResult;
  });
  query.update = vi.fn((value: Record<string, unknown>) => {
    mode = "update";
    mocks.updates.push(value);
    return query;
  });
  query.maybeSingle = vi.fn(async () => {
    if (mode === "update") return mocks.updateResult;
    return mocks.openResults.shift() ?? { data: null, error: null };
  });
  return query;
}

function request(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/clock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "worker@example.com" });
  mocks.employee = {
    id: "employee-1",
    name: "Warehouse Worker",
    department: "warehouse",
    locations: LOCATION,
  };
  mocks.employeeError = null;
  mocks.openResults = [];
  mocks.weekEntries = [];
  mocks.weekError = null;
  mocks.insertResult = { error: null };
  mocks.updateResult = { data: { id: "shift" }, error: null };
  mocks.inserts = [];
  mocks.updates = [];
  mocks.getSupabase.mockImplementation(() => ({
    from: vi.fn((table: string) => table === "employees" ? employeeQuery() : timeEntriesQuery()),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/clock location and shift invariants", () => {
  it("returns a stable permission code when a geofenced clock-in has no position", async () => {
    const response = await POST(request({ action: "in" }));
    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "permission_required" });
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([
    ["inaccurate_location", { latitude: 43.65, longitude: -79.38, accuracy: 101, capturedAt: NOW.toISOString() }, 422],
    ["stale_location", { latitude: 43.65, longitude: -79.38, accuracy: 10, capturedAt: "2026-08-13T17:57:59.000Z" }, 422],
    ["invalid_location", { latitude: 91, longitude: -79.38, accuracy: 10, capturedAt: NOW.toISOString() }, 400],
  ])("rejects %s before writing", async (code, position, status) => {
    const response = await POST(request({ action: "in", position }));
    expect(response.status).toBe(status);
    await expect(responseBody(response)).resolves.toMatchObject({ code });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("rejects a fresh fix outside the configured geofence", async () => {
    const response = await POST(request({
      action: "in",
      position: { latitude: 44, longitude: -79.38, accuracy: 10, capturedAt: NOW.toISOString() },
    }));
    expect(response.status).toBe(403);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "outside_geofence" });
    expect(mocks.inserts).toHaveLength(0);
  });

  it.each([
    ["duplicate_shift", "2026-08-13T17:00:00.000Z"],
    ["stale_shift", "2026-08-12T23:00:00.000Z"],
  ])("rejects an existing open shift with %s", async (code, clockInAt) => {
    mocks.openResults = [{
      data: { id: "open", clock_in_at: clockInAt, clock_out_at: null, flagged: false },
      error: null,
    }];
    const response = await POST(request({
      action: "in",
      position: { latitude: 43.65, longitude: -79.38, accuracy: 10, capturedAt: NOW.toISOString() },
    }));
    expect(response.status).toBe(409);
    await expect(responseBody(response)).resolves.toMatchObject({ code });
  });

  it("records audit fields and uses the server clock for a successful clock-in", async () => {
    const created = {
      id: "created",
      clock_in_at: NOW.toISOString(),
      clock_out_at: null,
      flagged: false,
    };
    mocks.openResults = [
      { data: null, error: null },
      { data: created, error: null },
    ];
    mocks.weekEntries = [created];
    const capturedAt = "2026-08-13T17:59:30.000Z";

    const response = await POST(request({
      action: "in",
      position: { latitude: 43.65, longitude: -79.38, accuracy: 12.4, capturedAt },
    }));

    expect(response.status).toBe(200);
    expect(mocks.inserts).toEqual([expect.objectContaining({
      employee_id: "employee-1",
      location_name: "Toronto",
      clock_in_at: NOW.toISOString(),
      clock_in_distance_m: 0,
      clock_in_accuracy_m: 12,
      clock_in_position_captured_at: capturedAt,
    })]);
    await expect(responseBody(response)).resolves.toMatchObject({
      linked: true,
      open: { id: "created", stale: false },
    });
  });

  it("maps a database uniqueness race to duplicate_shift", async () => {
    mocks.openResults = [{ data: null, error: null }];
    mocks.insertResult = { error: { code: "23505", message: "duplicate" } };
    const response = await POST(request({
      action: "in",
      position: { latitude: 43.65, longitude: -79.38, accuracy: 10, capturedAt: NOW.toISOString() },
    }));
    expect(response.status).toBe(409);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "duplicate_shift" });
  });

  it("ignores a client clock-out time and records the server timestamp", async () => {
    const open = {
      id: "open",
      clock_in_at: "2026-08-13T12:00:00.000Z",
      clock_out_at: null,
      flagged: false,
    };
    mocks.openResults = [
      { data: open, error: null },
      { data: null, error: null },
    ];
    const response = await POST(request({ action: "out", clockOutAt: "2000-01-01T00:00:00.000Z" }));
    expect(response.status).toBe(200);
    expect(mocks.updates).toEqual([{ clock_out_at: NOW.toISOString() }]);
    await expect(responseBody(response)).resolves.toMatchObject({ open: null });
  });

  it("rejects an invalid store pin with a stable configuration error", async () => {
    mocks.employee = {
      id: "employee-1",
      name: "Warehouse Worker",
      department: "warehouse",
      locations: { ...LOCATION, latitude: 91 },
    };
    const response = await POST(request({ action: "in" }));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "geofence_unavailable" });
  });

  it("rejects a geofence radius that has no coordinates", async () => {
    mocks.employee = {
      id: "employee-1",
      name: "Warehouse Worker",
      department: "warehouse",
      locations: {
        name: "Toronto",
        latitude: null,
        longitude: null,
        clock_in_radius_m: 100,
      },
    };
    const response = await POST(request({ action: "in" }));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "geofence_unavailable" });
    expect(mocks.inserts).toHaveLength(0);
  });

  it("maps backend failures to server_unavailable", async () => {
    mocks.employeeError = { message: "database unavailable" };
    const response = await POST(request({ action: "in" }));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toMatchObject({ code: "server_unavailable" });
  });
});
