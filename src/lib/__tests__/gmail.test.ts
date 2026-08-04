import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDirection,
  exchangeGmailAuthorizationCode,
  extractEmail,
  gmailAuthorizationUrl,
  getGmailProfileEmail,
  INBOXES,
} from "@/lib/gmail";
import type { GmailMessage } from "@/lib/gmail";

function makeMsg(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "msg1",
    threadId: "thread1",
    from: "customer@example.com",
    to: "info@glass-railing.com",
    subject: "Quote request",
    date: "2026-03-01T10:00:00Z",
    snippet: "I'd like a quote for...",
    ...overrides,
  };
}

describe("classifyDirection", () => {
  const inbox = "info@glass-railing.com";

  it("returns inbound when from is a customer", () => {
    expect(classifyDirection(makeMsg({ from: "customer@example.com" }), inbox)).toBe("inbound");
  });

  it("returns outbound when from matches inbox email", () => {
    expect(classifyDirection(makeMsg({ from: "info@glass-railing.com" }), inbox)).toBe("outbound");
  });

  it("returns outbound when from contains inbox email in Name <email> format", () => {
    expect(classifyDirection(makeMsg({ from: "RF Transparent <info@glass-railing.com>" }), inbox)).toBe("outbound");
  });

  it("is case-insensitive", () => {
    expect(classifyDirection(makeMsg({ from: "INFO@GLASS-RAILING.COM" }), inbox)).toBe("outbound");
    expect(classifyDirection(makeMsg({ from: "Info@Glass-Railing.com" }), inbox)).toBe("outbound");
  });

  it("returns inbound when from is a different store email", () => {
    expect(classifyDirection(makeMsg({ from: "info@glassrailingstore.com" }), inbox)).toBe("inbound");
  });

  it("handles empty from as inbound", () => {
    expect(classifyDirection(makeMsg({ from: "" }), inbox)).toBe("inbound");
  });
});

describe("extractEmail", () => {
  it("extracts email from Name <email> format", () => {
    expect(extractEmail("John Doe <john@example.com>")).toBe("john@example.com");
  });

  it("returns raw email lowercased when no angle brackets", () => {
    expect(extractEmail("John@Example.COM")).toBe("john@example.com");
  });

  it("trims whitespace", () => {
    expect(extractEmail("  john@example.com  ")).toBe("john@example.com");
  });

  it("handles complex display names", () => {
    expect(extractEmail('"Doe, John" <john@example.com>')).toBe("john@example.com");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("gmailAuthorizationUrl", () => {
  it("requests offline access for the selected mailbox and uses the app callback", () => {
    vi.stubEnv("GMAIL_CLIENT_ID", "client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tools.example.com/");

    const url = new URL(gmailAuthorizationUrl(INBOXES[1], "state-value"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://tools.example.com/api/oauth/gmail/callback",
    );
    expect(url.searchParams.get("login_hint")).toBe(INBOXES[1].email);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-value");
  });
});

describe("exchangeGmailAuthorizationCode", () => {
  it("returns and caches offline credentials from Google", async () => {
    vi.stubEnv("GMAIL_CLIENT_ID", "client-id");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tools.example.com");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGmailAuthorizationCode("auth-code")).resolves.toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://tools.example.com/api/oauth/gmail/callback");
  });

  it("rejects an exchange that does not grant offline access", async () => {
    vi.stubEnv("GMAIL_CLIENT_ID", "client-id");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tools.example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), {
          status: 200,
        }),
      ),
    );

    await expect(exchangeGmailAuthorizationCode("auth-code")).rejects.toThrow(
      "Google did not return offline access",
    );
  });
});

describe("getGmailProfileEmail", () => {
  it("returns a normalized mailbox address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ emailAddress: "Info@Glass-Railing.com" }), { status: 200 }),
      ),
    );

    await expect(getGmailProfileEmail("access-token")).resolves.toBe(
      "info@glass-railing.com",
    );
  });
});
