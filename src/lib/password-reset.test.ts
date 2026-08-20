import { describe, expect, it } from "vitest";
import { passwordProblem, recoveryParams } from "./password-reset";

describe("passwordProblem", () => {
  it("rejects short passwords", () => {
    expect(passwordProblem("short", "short")).toMatch(/at least 8/);
  });

  it("rejects mismatched confirmation", () => {
    expect(passwordProblem("longenough", "different")).toMatch(/don't match/);
  });

  it("accepts a matching pair of sufficient length", () => {
    expect(passwordProblem("longenough", "longenough")).toBeNull();
  });

  it("checks length before the mismatch, so the first fix comes first", () => {
    expect(passwordProblem("short", "different")).toMatch(/at least 8/);
  });
});

describe("recoveryParams", () => {
  it("reads token_hash from the templated email link", () => {
    expect(recoveryParams("?token_hash=abc123&type=recovery")).toEqual({
      tokenHash: "abc123",
      code: null,
    });
  });

  it("reads the PKCE code fallback", () => {
    expect(recoveryParams("?code=uuid-here")).toEqual({
      tokenHash: null,
      code: "uuid-here",
    });
  });

  it("returns nulls when the page is opened without a link", () => {
    expect(recoveryParams("")).toEqual({ tokenHash: null, code: null });
  });
});
