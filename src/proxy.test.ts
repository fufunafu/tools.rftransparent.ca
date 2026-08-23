import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getUserMock,
  signOutMock,
  isAuthorizedEmailMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  signOutMock: vi.fn(),
  isAuthorizedEmailMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock,
    },
  })),
}));

vi.mock("@/lib/authz", () => ({
  isAuthorizedEmail: isAuthorizedEmailMock,
}));

vi.mock("@/lib/account-preferences", () => ({
  getAccountPreferences: vi.fn(() => ({ homePage: "/" })),
}));

import { proxy } from "@/proxy";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  getUserMock.mockResolvedValue({ data: { user: null } });
  signOutMock.mockResolvedValue({ error: null });
  isAuthorizedEmailMock.mockResolvedValue(true);
});

afterAll(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

describe("authentication proxy", () => {
  it.each(["/privacy", "/support"])("allows signed-out access to %s", async (path) => {
    const response = await proxy(new NextRequest(`https://tools.rftransparent.ca${path}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("internally rewrites Shopify's trailing-slash lead webhook", async () => {
    const response = await proxy(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads/webhook/?shop=b03ab8-c8.myshopify.com&timestamp=123&signature=abc",
      { method: "POST" },
    ));
    const rewritten = new URL(response.headers.get("x-middleware-rewrite")!);

    expect(rewritten.pathname).toBe("/api/customer-service/leads/webhook");
    expect(rewritten.searchParams.get("shop")).toBe("b03ab8-c8.myshopify.com");
    expect(rewritten.searchParams.get("timestamp")).toBe("123");
    expect(rewritten.searchParams.get("signature")).toBe("abc");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("preserves the default trailing-slash redirect on other routes", async () => {
    const response = await proxy(new NextRequest(
      "https://tools.rftransparent.ca/customer-service/leads/?source=website",
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(308);
    expect(location.pathname).toBe("/customer-service/leads");
    expect(location.searchParams.get("source")).toBe("website");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 for an expired private API session", async () => {
    const response = await proxy(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads",
    ));

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("redirects an expired page session to login with a return path", async () => {
    const response = await proxy(new NextRequest(
      "https://tools.rftransparent.ca/customer-service/leads?source=meta",
    ));
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/customer-service/leads?source=meta",
    );
  });

  it("returns JSON 403 and signs out an unauthorized API user", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { email: "outsider@example.com" } },
    });
    isAuthorizedEmailMock.mockResolvedValue(false);

    const response = await proxy(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads",
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});
