import { describe, it, expect } from "vitest";
import { startOfDayInTimeZone, BUSINESS_TIMEZONE } from "@/lib/dates";

const HOUR_MS = 3_600_000;

describe("BUSINESS_TIMEZONE", () => {
  it("is America/Toronto", () => {
    expect(BUSINESS_TIMEZONE).toBe("America/Toronto");
  });
});

describe("startOfDayInTimeZone", () => {
  it("maps a late-evening Toronto instant to that Toronto day's midnight (EDT, UTC-4)", () => {
    // 2026-07-24T03:00:00Z is 23:00 on July 23 in Toronto — still July 23 there,
    // even though the UTC date has already rolled to July 24.
    const result = startOfDayInTimeZone(new Date("2026-07-24T03:00:00Z"));
    expect(result.toISOString()).toBe("2026-07-23T04:00:00.000Z");
  });

  it("returns Toronto midnight for a midday summer instant", () => {
    const result = startOfDayInTimeZone(new Date("2026-07-24T15:00:00Z"));
    expect(result.toISOString()).toBe("2026-07-24T04:00:00.000Z");
  });

  it("uses the EST offset (UTC-5) in winter", () => {
    const result = startOfDayInTimeZone(new Date("2026-01-15T17:00:00Z"));
    expect(result.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("maps a late-evening winter instant to the previous Toronto day", () => {
    // 2026-01-15T03:00:00Z is 22:00 on January 14 in Toronto (EST)
    const result = startOfDayInTimeZone(new Date("2026-01-15T03:00:00Z"));
    expect(result.toISOString()).toBe("2026-01-14T05:00:00.000Z");
  });

  it("defaults the timezone parameter to BUSINESS_TIMEZONE", () => {
    const now = new Date("2026-07-24T03:00:00Z");
    expect(startOfDayInTimeZone(now).toISOString()).toBe(
      startOfDayInTimeZone(now, BUSINESS_TIMEZONE).toISOString()
    );
  });

  it("dayOffset=1 returns the next Toronto midnight", () => {
    const result = startOfDayInTimeZone(new Date("2026-07-24T15:00:00Z"), BUSINESS_TIMEZONE, 1);
    expect(result.toISOString()).toBe("2026-07-25T04:00:00.000Z");
  });

  it("dayOffset=-1 returns the previous Toronto midnight", () => {
    const result = startOfDayInTimeZone(new Date("2026-07-24T15:00:00Z"), BUSINESS_TIMEZONE, -1);
    expect(result.toISOString()).toBe("2026-07-23T04:00:00.000Z");
  });

  it("dayOffset rolls over month boundaries", () => {
    const result = startOfDayInTimeZone(new Date("2026-01-31T17:00:00Z"), BUSINESS_TIMEZONE, 1);
    expect(result.toISOString()).toBe("2026-02-01T05:00:00.000Z");
  });

  it("spring-forward day (2026-03-08) spans only 23 hours", () => {
    const now = new Date("2026-03-08T15:00:00Z"); // 11:00 EDT, after the 2am jump
    const today = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 0);
    const tomorrow = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 1);
    // Midnight March 8 is still EST (UTC-5); midnight March 9 is EDT (UTC-4)
    expect(today.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(tomorrow.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(tomorrow.getTime() - today.getTime()).toBe(23 * HOUR_MS);
  });

  it("handles an instant inside the spring-forward morning itself", () => {
    // 2026-03-08T06:30:00Z = 1:30 EST March 8 (before the 2am jump)
    const result = startOfDayInTimeZone(new Date("2026-03-08T06:30:00Z"));
    expect(result.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("fall-back day (2026-11-01) spans 25 hours", () => {
    const now = new Date("2026-11-01T15:00:00Z"); // 10:00 EST, after the fall-back
    const today = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 0);
    const tomorrow = startOfDayInTimeZone(now, BUSINESS_TIMEZONE, 1);
    // Midnight Nov 1 is still EDT (UTC-4); midnight Nov 2 is EST (UTC-5)
    expect(today.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(tomorrow.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(tomorrow.getTime() - today.getTime()).toBe(25 * HOUR_MS);
  });

  it("supports plain UTC as the timezone", () => {
    const result = startOfDayInTimeZone(new Date("2026-07-24T23:59:59Z"), "UTC");
    expect(result.toISOString()).toBe("2026-07-24T00:00:00.000Z");
  });
});
