import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateLink = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: { admin: { generateLink } } }),
}));

import { POST } from "@/app/api/auth/dev-login/route";

describe("POST /api/auth/dev-login", () => {
  beforeEach(() => {
    vi.stubEnv("ENABLE_TEST_LOGIN", "1");
    generateLink.mockReset();
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "local-test-token" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an owner sign-in token on localhost", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/auth/dev-login", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tokenHash: "local-test-token",
    });
    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "fuannegao25@gmail.com",
    });
  });

  it("returns 404 on the production hostname", async () => {
    const response = await POST(
      new Request("https://tools.rftransparent.ca/api/auth/dev-login", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });
});
