// The business operates in Toronto; Vercel servers run in UTC. Day-boundary
// queries ("due today", "overdue") must use Toronto midnight, not server
// midnight, or leads within 4-5 hours of midnight land in the wrong day.
export const BUSINESS_TIMEZONE = "America/Toronto";

// Offset (ms) between a timezone's wall-clock time and UTC at a given instant.
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - date.getTime();
}

// Returns the UTC instant of midnight in `timeZone` for the calendar day that
// `now` falls on there, shifted by `dayOffset` days (1 = tomorrow's midnight).
export function startOfDayInTimeZone(
  now: Date,
  timeZone: string = BUSINESS_TIMEZONE,
  dayOffset = 0
): Date {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const y = Number(dateParts.year);
  const m = Number(dateParts.month);
  const d = Number(dateParts.day) + dayOffset;

  // Start from "midnight as if the zone were UTC", then subtract the zone's
  // offset. Recompute once so days containing a DST transition converge.
  const naive = Date.UTC(y, m - 1, d);
  let ts = naive - tzOffsetMs(new Date(naive), timeZone);
  ts = naive - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}
