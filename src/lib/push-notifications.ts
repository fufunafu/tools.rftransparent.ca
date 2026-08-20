// Pure decision logic for push notifications — no I/O, fully unit-testable.
// The APNs wire protocol lives in src/lib/apns.ts; the cron routes own the
// database.

import { STALE_SHIFT_HOURS } from "@/lib/time-clock";
import { STORE_SCOPES, type StoreScope } from "@/lib/store-scopes";

// Nudge "Still clocked in?" once a shift passes this many hours. Past
// STALE_SHIFT_HOURS the shift stops counting anyway and the app itself asks
// for a real end time, so the reminder window is [10h, 14h).
export const CLOCK_REMINDER_AFTER_HOURS = 10;

export interface RemindableShift {
  clock_in_at: string;
  clock_out_at: string | null;
  reminder_sent_at: string | null;
}

export function shiftNeedsReminder(shift: RemindableShift, now: Date): boolean {
  if (shift.clock_out_at || shift.reminder_sent_at) return false;
  const elapsedH = (now.getTime() - Date.parse(shift.clock_in_at)) / 3_600_000;
  return elapsedH >= CLOCK_REMINDER_AFTER_HOURS && elapsedH < STALE_SHIFT_HOURS;
}

export function clockReminderText(clockInAt: string, now: Date): { title: string; body: string } {
  const hours = Math.floor((now.getTime() - Date.parse(clockInAt)) / 3_600_000);
  return {
    title: "Still clocked in?",
    body: `You've been on the clock for ${hours} hours. Tap to clock out if your shift is over.`,
  };
}

// Employee locations are stored with prefixes ("RF/GRS - Toronto",
// "BC - Laval"), so scope matching is by containment, not equality.
export function scopeForEmployeeLocationName(name: string | null): StoreScope | null {
  if (!name) return null;
  const normalized = name.toLowerCase();
  if (normalized.includes("toronto")) return STORE_SCOPES.toronto;
  if (
    normalized.includes("montreal") ||
    normalized.includes("montréal") ||
    normalized.includes("laval") ||
    normalized.includes("julie") ||
    normalized.includes("bc")
  ) {
    return STORE_SCOPES.montreal;
  }
  return null;
}

export function followupDigestText(
  due: number,
  overdue: number,
): { title: string; body: string } | null {
  if (due <= 0 && overdue <= 0) return null;
  const parts: string[] = [];
  if (due > 0) parts.push(`${due} follow-up${due === 1 ? "" : "s"} due today`);
  if (overdue > 0) parts.push(`${overdue} overdue`);
  return {
    title: "Follow-ups",
    body: `${parts.join(" · ")}. Open the app to see who's waiting.`,
  };
}
