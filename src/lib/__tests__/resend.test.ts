import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkResendHealth } from "@/lib/resend";

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkResendHealth", () => {
  it("verifies the sending domain with a full-access key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ name: "rftransparent.ca", status: "verified" }] }),
          { status: 200 },
        ),
      ),
    );

    await expect(checkResendHealth()).resolves.toBe("rftransparent.ca verified");
  });

  it("accepts a valid sending-access key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "restricted_api_key" }), { status: 401 }),
      ),
    );

    await expect(checkResendHealth()).resolves.toBe("Sending access key accepted");
  });

  it("rejects an invalid key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "invalid_api_key" }), { status: 403 }),
      ),
    );

    await expect(checkResendHealth()).rejects.toThrow("HTTP 403");
  });

  it("reports a missing key as unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(checkResendHealth()).rejects.toThrow("Not configured");
  });

  it("still reports an unverified domain with a full-access key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ name: "rftransparent.ca", status: "pending" }] }),
          { status: 200 },
        ),
      ),
    );

    await expect(checkResendHealth()).rejects.toThrow("rftransparent.ca is pending");
  });
});
