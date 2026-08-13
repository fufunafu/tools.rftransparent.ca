import { describe, expect, it } from "vitest";
import {
  checkGeofence,
  decimalHours,
  distanceMeters,
  entryMinutes,
  formatDistance,
  formatDuration,
  isStaleShift,
  startOfWeekInTimeZone,
  timeEntriesCsv,
  totalMinutes,
  validateSelfReportedClockOut,
  weekDayKeys,
  weekDays,
  type ClockEntry,
} from "@/lib/time-clock";

// Wednesday 2026-08-12 15:00 in Toronto (EDT, UTC-4) = 19:00 UTC.
const NOW = new Date("2026-08-12T19:00:00Z");

function entry(overrides: Partial<ClockEntry>): ClockEntry {
  return {
    id: "e1",
    clock_in_at: "2026-08-12T12:30:00Z",
    clock_out_at: null,
    flagged: false,
    ...overrides,
  };
}

describe("entryMinutes", () => {
  it("counts closed shifts", () => {
    const e = entry({ clock_in_at: "2026-08-12T12:30:00Z", clock_out_at: "2026-08-12T20:32:00Z" });
    expect(entryMinutes(e, NOW)).toBe(482); // 8h 02m
  });

  it("counts a fresh open shift up to now", () => {
    const e = entry({ clock_in_at: "2026-08-12T12:30:00Z" });
    expect(entryMinutes(e, NOW)).toBe(390); // 6h 30m
  });

  it("contributes nothing for a stale open shift", () => {
    const e = entry({ clock_in_at: "2026-08-11T12:00:00Z" }); // 31h ago
    expect(isStaleShift(e.clock_in_at, NOW)).toBe(true);
    expect(entryMinutes(e, NOW)).toBe(0);
  });

  it("still counts flagged-but-resolved shifts", () => {
    const e = entry({
      clock_in_at: "2026-08-11T12:00:00Z",
      clock_out_at: "2026-08-11T20:00:00Z",
      flagged: true,
    });
    expect(entryMinutes(e, NOW)).toBe(480);
  });
});

describe("startOfWeekInTimeZone", () => {
  it("returns Monday midnight Toronto for a mid-week date", () => {
    // Monday 2026-08-10 00:00 EDT = 04:00 UTC.
    expect(startOfWeekInTimeZone(NOW).toISOString()).toBe("2026-08-10T04:00:00.000Z");
  });

  it("returns the same day on a Monday", () => {
    const monday = new Date("2026-08-10T12:00:00Z");
    expect(startOfWeekInTimeZone(monday).toISOString()).toBe("2026-08-10T04:00:00.000Z");
  });

  it("keeps Sunday in the week that started the prior Monday", () => {
    // Sunday 2026-08-16 21:00 Toronto = 2026-08-17 01:00 UTC — still the
    // week of Monday the 10th in Toronto despite the UTC date.
    const sunday = new Date("2026-08-17T01:00:00Z");
    expect(startOfWeekInTimeZone(sunday).toISOString()).toBe("2026-08-10T04:00:00.000Z");
  });
});

describe("weekDays", () => {
  it("lists Monday through today with per-day totals", () => {
    const entries: ClockEntry[] = [
      entry({ id: "mon", clock_in_at: "2026-08-10T12:00:00Z", clock_out_at: "2026-08-10T20:02:00Z" }),
      entry({ id: "tue", clock_in_at: "2026-08-11T12:00:00Z", clock_out_at: "2026-08-11T19:48:00Z" }),
      entry({ id: "wed", clock_in_at: "2026-08-12T12:30:00Z" }), // running
    ];
    const days = weekDays(entries, NOW);
    expect(days.map((d) => d.label)).toEqual(["Mon", "Tue", "Wed"]);
    expect(days[0]).toMatchObject({ date: "2026-08-10", minutes: 482, open: false });
    expect(days[1]).toMatchObject({ date: "2026-08-11", minutes: 468, open: false });
    expect(days[2]).toMatchObject({ date: "2026-08-12", minutes: 390, open: true });
  });

  it("assigns a shift crossing Toronto midnight to its start day", () => {
    // 21:00 Mon → 01:00 Tue Toronto.
    const entries = [
      entry({ clock_in_at: "2026-08-11T01:00:00Z", clock_out_at: "2026-08-11T05:00:00Z" }),
    ];
    const days = weekDays(entries, NOW);
    expect(days[0].minutes).toBe(240); // all on Monday
    expect(days[1].minutes).toBe(0);
  });

  it("ignores entries from before this week", () => {
    const entries = [
      entry({ clock_in_at: "2026-08-07T12:00:00Z", clock_out_at: "2026-08-07T20:00:00Z" }),
    ];
    expect(totalMinutes(entries, NOW)).toBe(480); // counted raw…
    expect(weekDays(entries, NOW).reduce((s, d) => s + d.minutes, 0)).toBe(0); // …but not in the week
  });
});

describe("weekDayKeys", () => {
  it("returns the full Mon–Sun for a week start", () => {
    const weekStart = new Date("2026-08-10T04:00:00Z"); // Monday midnight Toronto
    const days = weekDayKeys(weekStart);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-08-10", label: "Mon" });
    expect(days[6]).toEqual({ date: "2026-08-16", label: "Sun" });
  });
});

describe("decimalHours", () => {
  it("rounds to two decimals", () => {
    expect(decimalHours(482)).toBe(8.03);
    expect(decimalHours(0)).toBe(0);
  });
});

describe("timeEntriesCsv", () => {
  it("formats shifts in Toronto time with escaping", () => {
    const csv = timeEntriesCsv(
      [
        {
          employeeName: 'Sam "Sammy" Rivera',
          department: "sales",
          locationName: "Store 2, North",
          clock_in_at: "2026-08-10T12:30:00Z", // 08:30 Toronto
          clock_out_at: "2026-08-10T20:32:00Z", // 16:32 Toronto
          flagged: false,
          flag_reason: null,
          edit_note: null,
        },
        {
          employeeName: "Ana Cruz",
          department: "warehouse",
          locationName: null,
          clock_in_at: "2026-08-11T12:00:00Z",
          clock_out_at: null, // still open — must export as zero hours
          flagged: true,
          flag_reason: "Forgot to clock out",
          edit_note: null,
        },
      ],
      NOW,
    );
    const [header, row1, row2] = csv.split("\n");
    expect(header).toBe("Employee,Department,Store,Date,Clock in,Clock out,Hours,Flagged,Note");
    expect(row1).toBe('"Sam ""Sammy"" Rivera",sales,"Store 2, North",2026-08-10,08:30,16:32,8.03,,');
    expect(row2).toBe("Ana Cruz,warehouse,,2026-08-11,08:00,,0,yes,Forgot to clock out");
  });
});

describe("geofence", () => {
  // CN Tower and Rogers Centre, Toronto — about 350m apart.
  const cnTower = { latitude: 43.6426, longitude: -79.3871 };
  const rogersCentre = { latitude: 43.6414, longitude: -79.3894 };

  it("measures a known distance within tolerance", () => {
    const d = distanceMeters(cnTower.latitude, cnTower.longitude, rogersCentre.latitude, rogersCentre.longitude);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(300);
  });

  it("accepts a phone inside the radius", () => {
    const result = checkGeofence(
      { ...rogersCentre, accuracy: 20 },
      { ...cnTower, radiusM: 300 },
    );
    expect(result.ok).toBe(true);
    expect(result.allowedM).toBe(320);
  });

  it("rejects a phone outside the radius", () => {
    const result = checkGeofence(
      { ...rogersCentre, accuracy: 10 },
      { ...cnTower, radiusM: 100 },
    );
    expect(result.ok).toBe(false);
  });

  it("caps the accuracy credit so a bad GPS fix can't grant a kilometer", () => {
    const result = checkGeofence(
      { ...rogersCentre, accuracy: 5000 },
      { ...cnTower, radiusM: 100 },
    );
    expect(result.allowedM).toBe(200); // 100 radius + 100 capped credit
    expect(result.ok).toBe(false);
  });

  it("uses the default radius when the location has none", () => {
    const result = checkGeofence({ ...cnTower, accuracy: 0 }, { ...cnTower });
    expect(result.ok).toBe(true);
    expect(result.allowedM).toBe(200);
  });
});

describe("formatDistance", () => {
  it("formats meters and kilometers", () => {
    expect(formatDistance(240)).toBe("240 m");
    expect(formatDistance(3400)).toBe("3.4 km");
  });
});

describe("formatDuration", () => {
  it("pads minutes", () => {
    expect(formatDuration(482)).toBe("8h 02m");
    expect(formatDuration(0)).toBe("0h 00m");
    expect(formatDuration(59)).toBe("0h 59m");
  });
});

describe("validateSelfReportedClockOut", () => {
  const clockIn = "2026-08-11T12:00:00Z";

  it("accepts a sane end time", () => {
    expect(validateSelfReportedClockOut(clockIn, "2026-08-11T20:00:00Z", NOW)).toBeNull();
  });

  it("rejects an end before the start", () => {
    expect(validateSelfReportedClockOut(clockIn, "2026-08-11T11:00:00Z", NOW)).toMatch(/after/);
  });

  it("rejects future end times", () => {
    expect(validateSelfReportedClockOut(clockIn, "2026-08-12T20:00:00Z", NOW)).toMatch(/future/);
  });

  it("rejects shifts longer than the self-report cap", () => {
    expect(validateSelfReportedClockOut(clockIn, "2026-08-12T04:00:00Z", NOW)).toMatch(/manager/);
  });

  it("rejects garbage input", () => {
    expect(validateSelfReportedClockOut(clockIn, "not-a-date", NOW)).toMatch(/valid/);
  });
});
