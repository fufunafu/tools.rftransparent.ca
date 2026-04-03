import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers before importing the module
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

// Set env before import
process.env.ADMIN_PASSWORD = "test-secret-password";

import { validatePassword, createToken, COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } from "@/lib/admin-auth";

beforeEach(() => {
  process.env.ADMIN_PASSWORD = "test-secret-password";
});

describe("validatePassword", () => {
  it("returns true for correct password", () => {
    expect(validatePassword("test-secret-password")).toBe(true);
  });

  it("returns true for correct password with whitespace", () => {
    expect(validatePassword("  test-secret-password  ")).toBe(true);
  });

  it("returns false for wrong password", () => {
    expect(validatePassword("wrong-password")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validatePassword("")).toBe(false);
  });

  it("returns false when ADMIN_PASSWORD is not set", () => {
    const original = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    expect(validatePassword("anything")).toBe(false);
    process.env.ADMIN_PASSWORD = original;
  });
});

describe("createToken", () => {
  it("returns a string with three colon-separated parts", () => {
    const token = createToken();
    const parts = token.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("admin");
    // Second part should be a numeric timestamp
    expect(Number(parts[1])).toBeGreaterThan(0);
    // Third part is the HMAC hex digest (64 chars for SHA-256)
    expect(parts[2]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces valid token format consistently", () => {
    const token1 = createToken();
    const token2 = createToken();
    // Both should have valid format
    for (const token of [token1, token2]) {
      const parts = token.split(":");
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe("admin");
      expect(parts[2]).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("constants", () => {
  it("has correct cookie name", () => {
    expect(COOKIE_NAME).toBe("admin_session");
  });

  it("has 24-hour max age", () => {
    expect(COOKIE_MAX_AGE_SECONDS).toBe(86400);
  });
});
