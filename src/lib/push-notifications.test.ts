import { describe, expect, it } from "vitest";
import {
  clockReminderText,
  followupDigestText,
  scopeForEmployeeLocationName,
  shiftNeedsReminder,
} from "@/lib/push-notifications";

const NOW = new Date("2026-08-20T20:00:00Z");

describe("shiftNeedsReminder", () => {
  const shift = (hoursAgo: number, overrides = {}) => ({
    clock_in_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    clock_out_at: null,
    reminder_sent_at: null,
    ...overrides,
  });

  it("reminds an open shift between 10 and 14 hours", () => {
    expect(shiftNeedsReminder(shift(9.5), NOW)).toBe(false);
    expect(shiftNeedsReminder(shift(10), NOW)).toBe(true);
    expect(shiftNeedsReminder(shift(13.9), NOW)).toBe(true);
  });

  it("stops reminding once the shift is stale — the app takes over there", () => {
    expect(shiftNeedsReminder(shift(14.1), NOW)).toBe(false);
  });

  it("never reminds a closed shift or one already reminded", () => {
    expect(shiftNeedsReminder(shift(11, { clock_out_at: NOW.toISOString() }), NOW)).toBe(false);
    expect(shiftNeedsReminder(shift(11, { reminder_sent_at: NOW.toISOString() }), NOW)).toBe(false);
  });
});

describe("clockReminderText", () => {
  it("keeps shift details out of lock-screen copy", () => {
    const clockIn = new Date(NOW.getTime() - 10.7 * 3_600_000).toISOString();
    const text = clockReminderText(clockIn, NOW);
    expect(text).toEqual({
      title: "Check your clock status",
      body: "A shift may still be running. Open RF Tools to review it.",
    });
    expect(JSON.stringify(text)).not.toContain(clockIn);
    expect(JSON.stringify(text)).not.toMatch(/10\s*hours/i);
  });
});

describe("scopeForEmployeeLocationName", () => {
  it("maps the real location names to scopes", () => {
    expect(scopeForEmployeeLocationName("RF/GRS - Toronto")?.slug).toBe("toronto");
    expect(scopeForEmployeeLocationName("BC - Laval")?.slug).toBe("montreal");
    expect(scopeForEmployeeLocationName("BC - Ste-Julie")?.slug).toBe("montreal");
    expect(scopeForEmployeeLocationName(null)).toBeNull();
    expect(scopeForEmployeeLocationName("Somewhere else")).toBeNull();
  });
});

describe("followupDigestText", () => {
  it("summarizes due and overdue, singular and plural", () => {
    expect(followupDigestText(1, 0)?.body).toContain("1 follow-up due today");
    expect(followupDigestText(3, 2)?.body).toContain("3 follow-ups due today · 2 overdue");
  });

  it("returns null when there is nothing to say", () => {
    expect(followupDigestText(0, 0)).toBeNull();
  });
});
