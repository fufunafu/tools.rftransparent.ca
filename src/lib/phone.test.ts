import { describe, expect, it } from "vitest";
import {
  getInternationalPhoneError,
  normalizeInternationalPhone,
  normalizeOptionalInternationalPhone,
} from "@/lib/phone";

describe("international phone normalization", () => {
  it("stores formatted international numbers as canonical E.164", () => {
    expect(normalizeInternationalPhone("+1 (416) 555-0123")).toBe("+14165550123");
  });

  it("removes invisible Unicode direction controls", () => {
    expect(normalizeInternationalPhone("+1 4385056381\u202c")).toBe("+14385056381");
  });

  it("requires a country-code prefix", () => {
    expect(() => normalizeInternationalPhone("416-555-0123")).toThrow(
      "international WhatsApp number",
    );
  });

  it("rejects unsupported visible characters", () => {
    expect(() => normalizeInternationalPhone("+1 416 555 0123 ext 4")).toThrow(
      "international WhatsApp number",
    );
  });

  it("allows an empty optional employee phone", () => {
    expect(normalizeOptionalInternationalPhone("  ")).toBeNull();
    expect(getInternationalPhoneError("")).toBeNull();
  });
});
