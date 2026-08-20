// Pure clock in/out logic — durations, week grouping, and the "forgot to
// clock out" rules. No I/O here so it's fully unit-testable; the API route
// owns the database.

import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";

// An open shift older than this is treated as a forgotten clock-out: its
// running time stops counting toward totals, and the employee is asked to
// report the real end time (which flags the entry for manager review).
export const STALE_SHIFT_HOURS = 14;

// Longest end time an employee may self-report for a forgotten clock-out,
// measured from clock-in. Anything longer needs a manager.
export const MAX_SELF_REPORT_HOURS = 14;

export interface ClockEntry {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  flagged: boolean;
}

export interface WeekDay {
  // "YYYY-MM-DD" in the business timezone.
  date: string;
  // "Mon" … "Sun".
  label: string;
  minutes: number;
  // True while a shift that started this day is still running.
  open: boolean;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isStaleShift(clockInAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(clockInAt) > STALE_SHIFT_HOURS * 60 * 60 * 1000;
}

// Minutes a single entry contributes to totals. Closed entries count as-is
// (a flagged-but-resolved shift is still a real shift — the flag routes it
// to manager review, it doesn't erase the time). A running shift counts its
// elapsed time unless it has gone stale, in which case it contributes
// nothing until the employee reports the real end time.
export function entryMinutes(entry: ClockEntry, now: Date): number {
  const start = Date.parse(entry.clock_in_at);
  if (entry.clock_out_at) {
    return Math.max(0, Math.floor((Date.parse(entry.clock_out_at) - start) / MS_PER_MINUTE));
  }
  if (isStaleShift(entry.clock_in_at, now)) return 0;
  return Math.max(0, Math.floor((now.getTime() - start) / MS_PER_MINUTE));
}

export function dayKeyInTimeZone(date: Date, timeZone: string = BUSINESS_TIMEZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
}

// UTC instant of the most recent Monday 00:00 in the business timezone.
export function startOfWeekInTimeZone(now: Date, timeZone: string = BUSINESS_TIMEZONE): Date {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const daysSinceMonday = labels.indexOf(weekdayLabel(now, timeZone));
  return startOfDayInTimeZone(now, timeZone, -Math.max(0, daysSinceMonday));
}

// One row per day from Monday through today. Shifts belong to the day they
// started on (an overnight shift counts on its start day).
export function weekDays(
  entries: ClockEntry[],
  now: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): WeekDay[] {
  const weekStart = startOfWeekInTimeZone(now, timeZone);
  const todayKey = dayKeyInTimeZone(now, timeZone);

  const days: WeekDay[] = [];
  // A calendar day is at least 23 hours (DST); stepping by noon of each day
  // and re-keying keeps day boundaries exact without offset math.
  for (let i = 0; i < 7; i++) {
    const probe = new Date(weekStart.getTime() + i * MS_PER_DAY + MS_PER_DAY / 2);
    const key = dayKeyInTimeZone(probe, timeZone);
    days.push({ date: key, label: weekdayLabel(probe, timeZone), minutes: 0, open: false });
    if (key === todayKey) break;
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const entry of entries) {
    const day = byDate.get(dayKeyInTimeZone(new Date(entry.clock_in_at), timeZone));
    if (!day) continue;
    day.minutes += entryMinutes(entry, now);
    if (!entry.clock_out_at) day.open = true;
  }
  return days;
}

export function totalMinutes(entries: ClockEntry[], now: Date): number {
  return entries.reduce((sum, e) => sum + entryMinutes(e, now), 0);
}

// The 7 calendar days of the week starting at `weekStart` (a Monday-midnight
// instant from startOfWeekInTimeZone). Unlike weekDays(), this always returns
// the full Mon–Sun — the manager table shows the whole week.
export function weekDayKeys(
  weekStart: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): { date: string; label: string }[] {
  const days: { date: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const probe = new Date(weekStart.getTime() + i * MS_PER_DAY + MS_PER_DAY / 2);
    days.push({
      date: dayKeyInTimeZone(probe, timeZone),
      label: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(probe),
    });
  }
  return days;
}

// Payroll-friendly decimal hours, two decimals.
export function decimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvEntry {
  employeeName: string;
  department: string;
  locationName: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  flagged: boolean;
  flag_reason: string | null;
  edit_note: string | null;
}

// One CSV line per shift, times in the business timezone. Open shifts export
// with an empty clock-out and zero hours so payroll can't silently count a
// still-running (or forgotten) shift.
export function timeEntriesCsv(entries: CsvEntry[], now: Date): string {
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const header = "Employee,Department,Store,Date,Clock in,Clock out,Hours,Flagged,Note";
  const lines = entries.map((e) => {
    const minutes = e.clock_out_at
      ? entryMinutes({ id: "", clock_in_at: e.clock_in_at, clock_out_at: e.clock_out_at, flagged: e.flagged }, now)
      : 0;
    return [
      csvField(e.employeeName),
      csvField(e.department),
      csvField(e.locationName ?? ""),
      dayKeyInTimeZone(new Date(e.clock_in_at)),
      time.format(new Date(e.clock_in_at)),
      e.clock_out_at ? time.format(new Date(e.clock_out_at)) : "",
      String(decimalHours(minutes)),
      e.flagged ? "yes" : "",
      csvField(e.flag_reason ?? e.edit_note ?? ""),
    ].join(",");
  });
  return [header, ...lines].join("\n");
}

// ── Geofenced clock-in ──────────────────────────────────────────────────────

// Default allowed distance from the store pin. Generous enough for a big
// parking lot; per-location override lives in locations.clock_in_radius_m.
export const GEOFENCE_DEFAULT_RADIUS_M = 200;

// GPS accuracy varies (indoors it can be 50m+). The reported accuracy is
// added to the allowed radius, capped so a wildly-imprecise fix can't grant
// a kilometer of slack.
export const GEOFENCE_MAX_ACCURACY_CREDIT_M = 100;

// Reject fixes that are too imprecise to prove an employee is at the store.
// This is intentionally equal to the largest accuracy allowance used above.
export const GEOFENCE_MAX_ACCEPTABLE_ACCURACY_M = 100;

// The phone must provide a recent fix. A short future tolerance accounts for
// modest device clock drift without accepting arbitrarily future timestamps.
export const GEOFENCE_MAX_POSITION_AGE_MS = 2 * 60 * 1000;
export const GEOFENCE_FUTURE_TOLERANCE_MS = 30 * 1000;

const EARTH_RADIUS_M = 6_371_000;

export interface ClockPositionInput {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

export type ClockPositionErrorCode =
  | "invalid_location"
  | "inaccurate_location"
  | "stale_location";

export type ClockPositionValidation =
  | { ok: true; position: ClockPositionInput; capturedAt: Date }
  | { ok: false; code: ClockPositionErrorCode };

export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function validateClockPosition(
  value: unknown,
  now: Date,
): ClockPositionValidation {
  if (!value || typeof value !== "object") return { ok: false, code: "invalid_location" };
  const input = value as Partial<ClockPositionInput>;
  if (
    !isValidLatitude(input.latitude) ||
    !isValidLongitude(input.longitude) ||
    typeof input.accuracy !== "number" ||
    !Number.isFinite(input.accuracy) ||
    input.accuracy < 0 ||
    typeof input.capturedAt !== "string"
  ) {
    return { ok: false, code: "invalid_location" };
  }
  if (input.accuracy > GEOFENCE_MAX_ACCEPTABLE_ACCURACY_M) {
    return { ok: false, code: "inaccurate_location" };
  }

  const capturedAt = new Date(input.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) return { ok: false, code: "invalid_location" };
  const ageMs = now.getTime() - capturedAt.getTime();
  if (ageMs > GEOFENCE_MAX_POSITION_AGE_MS || ageMs < -GEOFENCE_FUTURE_TOLERANCE_MS) {
    return { ok: false, code: "stale_location" };
  }

  return {
    ok: true,
    position: {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      capturedAt: input.capturedAt,
    },
    capturedAt,
  };
}

// Haversine great-circle distance in meters.
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}

export interface GeofenceCheck {
  ok: boolean;
  distanceM: number;
  allowedM: number;
}

export function checkGeofence(
  position: { latitude: number; longitude: number; accuracy?: number },
  pin: { latitude: number; longitude: number; radiusM?: number | null },
): GeofenceCheck {
  const distanceM = distanceMeters(
    position.latitude,
    position.longitude,
    pin.latitude,
    pin.longitude,
  );
  const allowedM =
    (pin.radiusM ?? GEOFENCE_DEFAULT_RADIUS_M) +
    Math.min(Math.max(0, position.accuracy ?? 0), GEOFENCE_MAX_ACCURACY_CREDIT_M);
  return { ok: distanceM <= allowedM, distanceM, allowedM };
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.abs(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// Validates a self-reported end time for a forgotten clock-out. Returns an
// error message, or null when the value is acceptable.
export function validateSelfReportedClockOut(
  clockInAt: string,
  clockOutAt: string,
  now: Date,
): string | null {
  const start = Date.parse(clockInAt);
  const end = Date.parse(clockOutAt);
  if (Number.isNaN(end)) return "That end time isn't a valid date.";
  if (end <= start) return "The end time must be after the clock-in time.";
  if (end > now.getTime()) return "The end time can't be in the future.";
  if (end - start > MAX_SELF_REPORT_HOURS * 60 * 60 * 1000) {
    return `Shifts longer than ${MAX_SELF_REPORT_HOURS} hours need a manager to fix the entry.`;
  }
  return null;
}
