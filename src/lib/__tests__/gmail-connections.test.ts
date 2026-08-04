import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

import {
  getGmailConnectionStatus,
  INBOXES,
  saveGmailConnection,
} from "@/lib/gmail";

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: mocks.maybeSingle,
    upsert: mocks.upsert,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.getSupabase.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Gmail connection storage", () => {
  it("stores a connected mailbox in the protected app settings table", async () => {
    await saveGmailConnection(INBOXES[0], "refresh-token", "admin@example.com");

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [row, options] = mocks.upsert.mock.calls[0];
    expect(row.key).toBe(`gmail_connection:${INBOXES[0].email}`);
    expect(row.value).toMatchObject({
      inbox: INBOXES[0].email,
      refresh_token: "refresh-token",
      connected_by: "admin@example.com",
    });
    expect(options).toEqual({ onConflict: "key" });
  });

  it("reports a stored connection before checking the legacy environment token", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { value: { refresh_token: "database-token" } },
      error: null,
    });
    vi.stubEnv(INBOXES[0].refreshTokenEnv, "environment-token");

    await expect(getGmailConnectionStatus(INBOXES[0])).resolves.toEqual({
      inbox: INBOXES[0].email,
      connected: true,
      source: "database",
    });
  });

  it("uses an existing environment token as a rollout fallback", async () => {
    vi.stubEnv(INBOXES[0].refreshTokenEnv, "environment-token");

    await expect(getGmailConnectionStatus(INBOXES[0])).resolves.toEqual({
      inbox: INBOXES[0].email,
      connected: true,
      source: "environment",
    });
  });
});
