import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getProfileEmail: vi.fn(),
  isAdminEmail: vi.fn(),
  saveConnection: vi.fn(),
  syncInbox: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/authz", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));
vi.mock("@/lib/gmail", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/gmail")>();
  return {
    ...original,
    exchangeGmailAuthorizationCode: mocks.exchangeCode,
    getGmailProfileEmail: mocks.getProfileEmail,
    saveGmailConnection: mocks.saveConnection,
  };
});
vi.mock("@/lib/gmail-sync", () => ({
  syncGmailInbox: mocks.syncInbox,
}));

import { GET as startOAuth } from "@/app/api/oauth/gmail/route";
import { GET as finishOAuth } from "@/app/api/oauth/gmail/callback/route";
import {
  GMAIL_OAUTH_INBOX_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE,
  INBOXES,
} from "@/lib/gmail";

const inbox = INBOXES[0];

function callbackRequest(state = "expected-state") {
  return new NextRequest(
    `https://tools.rftransparent.ca/api/oauth/gmail/callback?code=auth-code&state=${state}`,
    {
      headers: {
        cookie: `${GMAIL_OAUTH_STATE_COOKIE}=expected-state; ${GMAIL_OAUTH_INBOX_COOKIE}=${encodeURIComponent(inbox.email)}`,
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GMAIL_CLIENT_ID", "client-id");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tools.rftransparent.ca");
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminEmail.mockResolvedValue(true);
  mocks.exchangeCode.mockResolvedValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
  });
  mocks.getProfileEmail.mockResolvedValue(inbox.email);
  mocks.saveConnection.mockResolvedValue(undefined);
  mocks.syncInbox.mockResolvedValue({ inbox: inbox.email, status: "success", count: 12 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Gmail OAuth routes", () => {
  it("starts authorization with protected state and inbox cookies", async () => {
    const response = await startOAuth(
      new NextRequest(
        `https://tools.rftransparent.ca/api/oauth/gmail?inbox=${encodeURIComponent(inbox.email)}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("accounts.google.com/o/oauth2/v2/auth");
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain(GMAIL_OAUTH_STATE_COOKIE);
    expect(cookies).toContain(GMAIL_OAUTH_INBOX_COOKIE);
    expect(cookies.toLowerCase()).toContain("httponly");
  });

  it("rejects a callback whose state does not match", async () => {
    const response = await finishOAuth(callbackRequest("wrong-state"));

    expect(response.headers.get("location")).toContain("gmail_status=error");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.saveConnection).not.toHaveBeenCalled();
  });

  it("does not save a different Google mailbox", async () => {
    mocks.getProfileEmail.mockResolvedValue("someone-else@example.com");

    const response = await finishOAuth(callbackRequest());

    expect(response.headers.get("location")).toContain("gmail_status=error");
    expect(mocks.saveConnection).not.toHaveBeenCalled();
    expect(mocks.syncInbox).not.toHaveBeenCalled();
  });

  it("saves the refresh token and synchronizes the selected mailbox", async () => {
    const response = await finishOAuth(callbackRequest());

    expect(mocks.saveConnection).toHaveBeenCalledWith(inbox, "refresh-token", "admin@example.com");
    expect(mocks.syncInbox).toHaveBeenCalledWith(inbox);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("gmail_status=success");
    expect(new URL(location).searchParams.get("gmail_message")).toContain(
      "12 recent messages were synchronized",
    );
  });
});
