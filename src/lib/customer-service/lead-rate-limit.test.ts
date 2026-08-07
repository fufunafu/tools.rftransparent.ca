import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

import { enforceLeadIngestionRateLimit } from "@/lib/customer-service/lead-rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lead ingestion rate limiting", () => {
  it("enforces client and shop limits without storing the raw client IP", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: [{ allowed: true, remaining: 8, retry_after_seconds: 600 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: true, remaining: 280, retry_after_seconds: 600 }],
        error: null,
      });
    const request = new NextRequest("https://tools.rftransparent.ca/api/leads", {
      headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
    });

    await expect(enforceLeadIngestionRateLimit(
      request,
      "example.myshopify.com",
      "submit",
    )).resolves.toEqual({ ok: true, remaining: 8 });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    const firstArgs = rpcMock.mock.calls[0][1];
    expect(firstArgs.p_limit).toBe(10);
    expect(firstArgs.p_key).not.toContain("203.0.113.42");
    expect(firstArgs.p_key).toContain("example.myshopify.com");
  });

  it("fails closed when the persistent limiter is unavailable", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "function is missing" },
    });

    const result = await enforceLeadIngestionRateLimit(
      new NextRequest("https://tools.rftransparent.ca/api/leads"),
      "example.myshopify.com",
      "upload",
    );

    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});
