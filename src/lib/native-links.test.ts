import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuthorizedNativeLink, resolveNativeLink } from "@/lib/native-links";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native universal-link routing", () => {
  it.each([
    ["https://tools.rftransparent.ca/", "/"],
    ["https://tools.rftransparent.ca/clock", "/clock"],
    ["https://tools.rftransparent.ca/todos?filter=today", "/todos?filter=today"],
    ["https://tools.rftransparent.ca/customer-service#callbacks", "/customer-service#callbacks"],
    ["https://tools.rftransparent.ca/warehouse/report", "/warehouse/report"],
    ["https://tools.rftransparent.ca/employees", "/employees"],
    ["https://tools.rftransparent.ca/warehouse", "/warehouse"],
  ])("routes a supported app destination", (input, expected) => {
    expect(resolveNativeLink(input)).toEqual({ kind: "destination", href: expected });
  });

  it.each([
    "https://evil.example/clock",
    "http://tools.rftransparent.ca/clock",
    "https://tools.rftransparent.ca/api/admin/me",
    "https://tools.rftransparent.ca/settings/access",
    "not a valid absolute route",
  ])("falls back safely for unsupported input", (input) => {
    expect(resolveNativeLink(input)).toEqual({
      kind: "unsupported",
      href: "/?native_link=unsupported",
    });
  });

  it("allows the exact configured origin during local native development", () => {
    expect(resolveNativeLink("/clock", "http://127.0.0.1:3000")).toEqual({
      kind: "destination",
      href: "/clock",
    });
  });

  it("falls back safely for expired, invalid, or ambiguous expirations", () => {
    const now = Date.parse("2026-08-24T18:00:00.000Z");
    for (const input of [
      "/todos?exp=1787594399",
      "/clock?expires=not-a-date",
      "/clock?exp=1787598000&expires_at=2026-08-24T19%3A00%3A00.000Z",
    ]) {
      expect(resolveNativeLink(input, "https://tools.rftransparent.ca", now)).toEqual({
        kind: "expired",
        href: "/?native_link=expired",
      });
    }
  });

  it("preserves a supported destination before its expiry", () => {
    expect(resolveNativeLink(
      "/todos?filter=today&expires_at=2026-08-24T19%3A00%3A00.000Z",
      "https://tools.rftransparent.ca",
      Date.parse("2026-08-24T18:00:00.000Z"),
    )).toEqual({
      kind: "destination",
      href: "/todos?filter=today&expires_at=2026-08-24T19%3A00%3A00.000Z",
    });
  });

  it("opens public and local destinations without a server authorization request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveAuthorizedNativeLink("/support")).resolves.toEqual({
      kind: "destination",
      href: "/support",
    });
    await expect(resolveAuthorizedNativeLink(
      "/clock",
      "http://127.0.0.1:3000",
    )).resolves.toEqual({ kind: "destination", href: "/clock" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the server-authorized destination for a protected link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      kind: "destination",
      href: "/clock",
    }), { status: 200 })));

    await expect(resolveAuthorizedNativeLink("/clock")).resolves.toEqual({
      kind: "destination",
      href: "/clock",
    });
  });

  it("provides safe session and role fallbacks", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const expired = await resolveAuthorizedNativeLink("/todos?filter=today");
    expect(expired.kind).toBe("unauthenticated");
    expect(new URL(expired.href, "https://tools.rftransparent.ca").searchParams.get("next"))
      .toBe("/todos?filter=today");
    await expect(resolveAuthorizedNativeLink("/warehouse/report")).resolves.toEqual({
      kind: "unauthorized",
      href: "/?native_link=unauthorized",
    });
  });

  it("fails safely when authorization is unavailable or returns a different route", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "destination",
        href: "/warehouse",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveAuthorizedNativeLink("/clock")).resolves.toEqual({
      kind: "unsupported",
      href: "/?native_link=unsupported",
    });
    await expect(resolveAuthorizedNativeLink("/todos")).resolves.toEqual({
      kind: "unsupported",
      href: "/?native_link=unsupported",
    });
  });
});
