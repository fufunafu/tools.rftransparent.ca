import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUserMock, fetchMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

import { GET } from "@/app/api/library-token/route";

const GENERATE_LINK_URL =
  "https://fojxkzruurdhzllsgiur.supabase.co/auth/v1/admin/generate_link";

/* A recognisable value, so "the key never reaches the browser" can be asserted
   against the real string rather than against the shape of a message. */
const SERVICE_KEY = "service-role-key-that-must-not-leak";

function upstreamCall() {
  const [url, init] = fetchMock.mock.calls[0];
  return { url, body: JSON.parse(String(init.body)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LIBRARY_SUPABASE_SERVICE_KEY", SERVICE_KEY);
  vi.stubGlobal("fetch", fetchMock);
  // Both failure arms log; keep the suite output readable.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  getAuthenticatedUserMock.mockResolvedValue({ email: "someone@example.com" });
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ hashed_token: "hashed-token" }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/library-token", () => {
  it("refuses a caller with no session", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    // The key is configured here on purpose: a 401 has to mean "no session",
    // not "not switched on".
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a session whose account carries no address", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ email: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports that sign-on is switched off without naming the key", async () => {
    vi.stubEnv("LIBRARY_SUPABASE_SERVICE_KEY", "");

    const response = await GET();
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).not.toContain(SERVICE_KEY);
    expect(serialized).not.toContain("LIBRARY_SUPABASE_SERVICE_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the library refuses the request", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 422 }));

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("No library account"),
    });
  });

  it("returns the hashed token and nothing else", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          action_link:
            "https://fojxkzruurdhzllsgiur.supabase.co/auth/v1/verify?token=raw-token&type=magiclink&redirect_to=https://tools.rftransparent.ca",
          hashed_token: "hashed-token",
        }),
        { status: 200 },
      ),
    );

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toEqual({ token_hash: "hashed-token" });
    // The action link would carry a redirect target and a refresh token in the
    // URL. The page needs neither, so none of it may travel.
    expect(Object.keys(body)).toEqual(["token_hash"]);
    expect(serialized).not.toContain("action_link");
    expect(serialized).not.toContain("redirect_to");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain(SERVICE_KEY);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reads the token from the nested properties shape too", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          properties: { hashed_token: "nested-token", action_link: "https://example.com" },
        }),
        { status: 200 },
      ),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ token_hash: "nested-token" });
  });

  it("answers 502 when the reply carries no token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ action_link: "https://example.com" }), { status: 200 }),
    );

    const response = await GET();

    expect(response.status).toBe(502);
  });

  it("answers 502 when the library cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));

    const response = await GET();

    expect(response.status).toBe(502);
  });

  it("asks the library for the session's own address, lowercased", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ email: "Someone.Else@Example.COM" });

    await GET();

    expect(upstreamCall()).toEqual({
      url: GENERATE_LINK_URL,
      body: { type: "magiclink", email: "someone.else@example.com" },
    });
  });

  it("tracks whichever address the session carries", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ email: "another@example.com" });

    await GET();

    expect(upstreamCall().body.email).toBe("another@example.com");
  });

  it("takes no request, so a caller has no way to name another address", () => {
    // The handler's signature is the guarantee: there is no request object to
    // read a body, a query string or a header from.
    expect(GET.length).toBe(0);
  });

  it("sends the service key upstream but only in the headers", async () => {
    await GET();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.apikey).toBe(SERVICE_KEY);
    expect(init.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(String(init.body)).not.toContain(SERVICE_KEY);
  });
});
