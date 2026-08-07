import { describe, expect, it } from "vitest";
import { listExtensions, normalizeExtension } from "@/lib/call-extensions";

describe("normalizeExtension", () => {
  it("accepts the extension formats used by call records", () => {
    expect(normalizeExtension(" 206 ")).toBe("206");
    expect(normalizeExtension("42")).toBe("42");
    expect(normalizeExtension("1204")).toBe("1204");
  });

  it("rejects voicemail labels and malformed values", () => {
    expect(normalizeExtension("VM_206")).toBeNull();
    expect(normalizeExtension("2")).toBeNull();
    expect(normalizeExtension("206,207")).toBeNull();
    expect(normalizeExtension(null)).toBeNull();
  });
});

describe("listExtensions", () => {
  it("returns unique numeric extensions in ascending order", () => {
    expect(listExtensions([
      { endpoint: "208" },
      { endpoint: "101" },
      { endpoint: "208" },
      { endpoint: "VM_206" },
      { endpoint: null },
    ])).toEqual(["101", "208"]);
  });
});
