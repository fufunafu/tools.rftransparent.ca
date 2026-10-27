import { describe, expect, it } from "vitest";
import { amazonPasswordProblem, amazonPasswordCurrent, recentAmazonMfa, AMAZON_PASSWORD_MAX_AGE_MS } from "./security-policy";

describe("Amazon credential policy", () => {
  it.each(["short1!A", "lowercaseonly12!", "UPPERCASEONLY12!", "NoDigitsHere!!", "NoSymbolsHere123", "A1!" + "x".repeat(70)])("rejects a noncompliant password", (password) => {
    expect(amazonPasswordProblem(password)).not.toBeNull();
  });
  it("accepts a strong password without trimming significant spaces", () => {
    expect(amazonPasswordProblem("Correct Horse 42!")).toBeNull();
  });
  it("expires at exactly 365 days and rejects missing, invalid, and future dates", () => {
    const now = Date.now();
    for (const value of [null, "bad", new Date(now + 1000).toISOString(), new Date(now - AMAZON_PASSWORD_MAX_AGE_MS).toISOString()]) expect(amazonPasswordCurrent(value, now)).toBe(false);
    expect(amazonPasswordCurrent(new Date(now - AMAZON_PASSWORD_MAX_AGE_MS + 1).toISOString(), now)).toBe(true);
  });
  it("requires a timestamped recent TOTP verification for password changes", () => {
    const now = 1_000_000;
    expect(recentAmazonMfa([{ method: "totp", timestamp: 990 }], now)).toBe(true);
    for (const entry of [{ method: "password", timestamp: 990 }, { method: "totp", timestamp: 700 }, { method: "totp", timestamp: 1001 }, "totp"]) expect(recentAmazonMfa([entry], now)).toBe(false);
  });
});
