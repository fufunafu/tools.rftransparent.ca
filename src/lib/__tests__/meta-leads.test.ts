import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMetaConnectionStatus,
  MetaGraphError,
  metaErrorMessage,
} from "@/lib/customer-service/meta-leads";

const originalToken = process.env.META_PAGE_ACCESS_TOKEN;

beforeEach(() => {
  process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) {
    delete process.env.META_PAGE_ACCESS_TOKEN;
  } else {
    process.env.META_PAGE_ACCESS_TOKEN = originalToken;
  }
});

describe("metaErrorMessage", () => {
  it("turns an expired-token response into an actionable configuration error", () => {
    const error = new MetaGraphError("session expired", 400, 190, 463);
    expect(metaErrorMessage(error)).toBe(
      "Meta access token expired. Replace META_PAGE_ACCESS_TOKEN in Vercel.",
    );
  });
});

describe("getMetaConnectionStatus", () => {
  it("reports an expired page token without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Session has expired",
              code: 190,
              error_subcode: 463,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(getMetaConnectionStatus()).resolves.toEqual({
      configured: true,
      connected: false,
      page_name: null,
      subscribed: false,
      error: "Meta access token expired. Replace META_PAGE_ACCESS_TOKEN in Vercel.",
    });
  });

  it("confirms the page and leadgen subscription", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "page-1", name: "RF Transparent" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "app-1",
                name: "RF Tools",
                subscribed_fields: ["leadgen"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMetaConnectionStatus()).resolves.toEqual({
      configured: true,
      connected: true,
      page_name: "RF Transparent",
      subscribed: true,
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
