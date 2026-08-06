import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getAuthenticatedUserMock, isAdminUserMock, fetchMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(),
  isAdminUserMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  isAdminUser: isAdminUserMock,
}));

vi.mock("@/lib/cron-monitor", () => ({
  getLatestCronRuns: vi.fn(),
}));

import { POST } from "@/app/api/settings/automations/route";

function request(job = "sync-calls") {
  return new NextRequest("https://tools.rftransparent.ca/api/settings/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-secret");
  getAuthenticatedUserMock.mockResolvedValue({ email: "admin@example.com" });
  isAdminUserMock.mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/settings/automations", () => {
  it("returns success when every sync result completed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [
        { scraper: "cik", status: "success" },
        { scraper: "lead-call-matching", status: "ok" },
      ],
    }), { status: 200 }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("returns an error when a provider reports a soft failure", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [
        { scraper: "cik", status: "success" },
        { scraper: "grasshopper", status: "2fa_required" },
      ],
    }), { status: 200 }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain("grasshopper: 2fa_required");
  });

  it("keeps manual automation runs admin-only", async () => {
    isAdminUserMock.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
