import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  isManagementUser: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
  isManagementUser: mocks.isManagementUser,
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: mocks.getSupabase }));

import { GET } from "@/app/api/employees/access/route";

// The employee id whose access rows were read, so each test can say whose
// list the caller was shown.
let readFor: string | null = null;

function makeClient(ownId: string | null) {
  return {
    from(table: string) {
      if (table === "employees") {
        const lookup = {
          select: () => lookup,
          or: () => lookup,
          limit: () => lookup,
          maybeSingle: async () => ({ data: ownId ? { id: ownId } : null, error: null }),
        };
        return lookup;
      }
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          readFor = value;
          return query;
        },
        order: async () => ({ data: [{ system: "Shopify" }], error: null }),
      };
      return query;
    },
  };
}

function request(query = "") {
  return new NextRequest(`https://tools.rftransparent.ca/api/employees/access${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  readFor = null;
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "me@glass-railing.com" });
  mocks.isAdminUser.mockResolvedValue(false);
  mocks.isManagementUser.mockResolvedValue(false);
  mocks.getSupabase.mockReturnValue(makeClient("emp-me"));
});

describe("GET /api/employees/access", () => {
  it("shows an admin their own list when nobody is named", async () => {
    mocks.isAdminUser.mockResolvedValue(true);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(readFor).toBe("emp-me");
  });

  it("lets an admin or manager name somebody else", async () => {
    mocks.isManagementUser.mockResolvedValue(true);

    await GET(request("?employeeId=emp-other"));

    expect(readFor).toBe("emp-other");
  });

  it("ignores a named employee for everybody else", async () => {
    await GET(request("?employeeId=emp-other"));

    expect(readFor).toBe("emp-me");
  });

  it("returns an empty list for a sign-in with no employee profile", async () => {
    mocks.getSupabase.mockReturnValue(makeClient(null));

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual({ access: [] });
    expect(readFor).toBeNull();
  });
});
