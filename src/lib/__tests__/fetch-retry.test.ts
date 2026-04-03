import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithRetry } from "@/lib/fetch-retry";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function serverError() {
  return new Response("Internal Server Error", { status: 500 });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchWithRetry", () => {
  it("returns immediately on a successful response", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ ok: true }));
    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on 4xx (does not retry client errors)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Bad Request", { status: 400 })
    );
    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    mockFetch
      .mockResolvedValueOnce(serverError())
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network error and succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries on network errors", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      fetchWithRetry("https://example.com", undefined, {
        retries: 2,
        baseDelayMs: 1,
      })
    ).rejects.toThrow("ECONNREFUSED");
    // initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("returns the 5xx response after exhausting retries", async () => {
    mockFetch.mockResolvedValue(serverError());

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 1,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
