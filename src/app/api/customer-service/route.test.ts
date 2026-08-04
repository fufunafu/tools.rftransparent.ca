import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  isAuthenticatedMock,
  isAdminUserMock,
  syncLeadCallStatusesMock,
} = vi.hoisted(() => ({
  isAuthenticatedMock: vi.fn(),
  isAdminUserMock: vi.fn(),
  syncLeadCallStatusesMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isAuthenticated: isAuthenticatedMock,
  isAdminUser: isAdminUserMock,
}));

vi.mock("@/lib/lead-call-sync", () => ({
  syncLeadCallStatuses: syncLeadCallStatusesMock,
}));

import { POST } from "@/app/api/customer-service/route";

function request() {
  return new NextRequest(
    "https://tools.rftransparent.ca/api/customer-service?action=sync-lead-calls",
    { method: "POST" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticatedMock.mockResolvedValue(true);
  isAdminUserMock.mockResolvedValue(true);
});

describe("POST /api/customer-service?action=sync-lead-calls", () => {
  it("requires an authenticated user", async () => {
    isAuthenticatedMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(syncLeadCallStatusesMock).not.toHaveBeenCalled();
  });

  it("requires an admin user", async () => {
    isAdminUserMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(syncLeadCallStatusesMock).not.toHaveBeenCalled();
  });

  it("matches imported calls to leads", async () => {
    const summary = {
      leadsScanned: 20,
      callsScanned: 40,
      matchedLeads: 3,
      called: 2,
      noAnswer: 1,
      attemptsSynced: 4,
      statusesUpdated: 3,
    };
    syncLeadCallStatusesMock.mockResolvedValue(summary);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "success",
      lead_call_sync: summary,
    });
  });

  it("returns a controlled error when matching fails", async () => {
    syncLeadCallStatusesMock.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "database unavailable" });
  });
});
