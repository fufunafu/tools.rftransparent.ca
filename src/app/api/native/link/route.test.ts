import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isManagementUser: vi.fn(),
  findActiveEmployeeByEmail: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isManagementUser: mocks.isManagementUser,
}));
vi.mock("@/lib/employee-profile", () => ({
  findActiveEmployeeByEmail: mocks.findActiveEmployeeByEmail,
}));

import { GET } from "@/app/api/native/link/route";

function request(href: string) {
  return new NextRequest(
    `https://tools.rftransparent.ca/api/native/link?href=${encodeURIComponent(href)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "worker@example.com" });
  mocks.isManagementUser.mockResolvedValue(false);
  mocks.findActiveEmployeeByEmail.mockResolvedValue({ department: "warehouse" });
});

describe("authorized native-link endpoint", () => {
  it("returns the safe fallback for an unsupported destination", async () => {
    const response = await GET(request("https://evil.example/clock"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "unsupported",
      href: "/?native_link=unsupported",
    });
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("returns an expired-link fallback before reading the session", async () => {
    const response = await GET(request("/clock?exp=1"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "expired",
      href: "/?native_link=expired",
    });
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("allows public support links without a session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(request("/support"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "destination",
      href: "/support",
    });
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("requires a fresh authenticated session", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET(request("/clock"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.findActiveEmployeeByEmail).not.toHaveBeenCalled();
  });

  it("does not query role data for a personal authenticated destination", async () => {
    const response = await GET(request("/todos?filter=today"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "destination",
      href: "/todos?filter=today",
    });
    expect(mocks.findActiveEmployeeByEmail).not.toHaveBeenCalled();
    expect(mocks.isManagementUser).not.toHaveBeenCalled();
  });

  it("allows a warehouse employee to open their report", async () => {
    const response = await GET(request("/warehouse/report"));
    expect(response.status).toBe(200);
    expect(mocks.findActiveEmployeeByEmail).toHaveBeenCalledWith("worker@example.com");
    expect(mocks.isManagementUser).not.toHaveBeenCalled();
  });

  it("allows sales notification taps to open the shared follow-up workflow", async () => {
    mocks.findActiveEmployeeByEmail.mockResolvedValue({ department: "sales" });
    const response = await GET(request("/customer-service/follow-up"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      kind: "destination",
      href: "/customer-service/follow-up",
    });
    expect(mocks.findActiveEmployeeByEmail).not.toHaveBeenCalled();
    expect(mocks.isManagementUser).not.toHaveBeenCalled();
  });

  it("sends a different role safely back to Home", async () => {
    mocks.findActiveEmployeeByEmail.mockResolvedValue({ department: "sales" });
    const response = await GET(request("/warehouse/report"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      kind: "unauthorized",
      href: "/?native_link=unauthorized",
    });
  });

  it("allows management to open management and frontline landing routes", async () => {
    mocks.findActiveEmployeeByEmail.mockResolvedValue({ department: "management" });
    mocks.isManagementUser.mockResolvedValue(true);

    for (const href of [
      "/warehouse",
      "/dashboards/marketing",
      "/employees",
      "/sales",
      "/customer-service",
      "/customer-service/follow-up",
      "/customer-service/problems",
    ]) {
      const response = await GET(request(href));
      expect(response.status).toBe(200);
    }
  });

  it("rejects a signed-in employee from another role before routing", async () => {
    mocks.findActiveEmployeeByEmail.mockResolvedValue({ department: "sales" });

    for (const href of [
      "/customer-service",
      "/warehouse",
    ]) {
      const response = await GET(request(href));
      expect(response.status).toBe(403);
    }
  });
});
