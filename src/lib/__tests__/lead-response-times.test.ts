import { describe, expect, it } from "vitest";
import {
  formatLeadResponseTime,
  leadResponseTimeMs,
} from "@/lib/lead-response-times";

describe("leadResponseTimeMs", () => {
  it("measures elapsed time from submission to completion", () => {
    expect(leadResponseTimeMs(
      "2026-08-05T12:00:00.000Z",
      "2026-08-05T13:42:00.000Z",
    )).toBe(102 * 60_000);
  });

  it("rejects missing, invalid, and pre-submission timestamps", () => {
    expect(leadResponseTimeMs("2026-08-05T12:00:00.000Z", null)).toBeNull();
    expect(leadResponseTimeMs("invalid", "2026-08-05T13:00:00.000Z")).toBeNull();
    expect(leadResponseTimeMs(
      "2026-08-05T13:00:00.000Z",
      "2026-08-05T12:00:00.000Z",
    )).toBeNull();
  });
});

describe("formatLeadResponseTime", () => {
  it("formats compact minute, hour, and day durations", () => {
    expect(formatLeadResponseTime(null)).toBe("No data");
    expect(formatLeadResponseTime(30_000)).toBe("<1m");
    expect(formatLeadResponseTime(42 * 60_000)).toBe("42m");
    expect(formatLeadResponseTime(102 * 60_000)).toBe("1h 42m");
    expect(formatLeadResponseTime(26 * 60 * 60_000)).toBe("1d 2h");
  });
});
