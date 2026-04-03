import { describe, it, expect } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test-allow-${Date.now()}`;
    const r1 = rateLimit(key, { maxAttempts: 3, windowMs: 60_000 });
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = rateLimit(key, { maxAttempts: 3, windowMs: 60_000 });
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = rateLimit(key, { maxAttempts: 3, windowMs: 60_000 });
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { maxAttempts: 3, windowMs: 60_000 });
    }

    const blocked = rateLimit(key, { maxAttempts: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("uses separate windows for different keys", () => {
    const key1 = `test-separate-a-${Date.now()}`;
    const key2 = `test-separate-b-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      rateLimit(key1, { maxAttempts: 3, windowMs: 60_000 });
    }

    // key1 is exhausted
    expect(rateLimit(key1, { maxAttempts: 3, windowMs: 60_000 }).allowed).toBe(false);
    // key2 is still fresh
    expect(rateLimit(key2, { maxAttempts: 3, windowMs: 60_000 }).allowed).toBe(true);
  });

  it("resets after window expires", async () => {
    const key = `test-reset-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { maxAttempts: 3, windowMs: 50 });
    }
    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));
    const result = rateLimit(key, { maxAttempts: 3, windowMs: 50 });
    expect(result.allowed).toBe(true);
  });

  it("defaults to 5 attempts per 15 minutes", () => {
    const key = `test-defaults-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key).allowed).toBe(true);
    }
    expect(rateLimit(key).allowed).toBe(false);
  });
});
