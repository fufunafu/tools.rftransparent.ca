import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";

export const REPORT_PERIODS = { this_week: "This week", last_week: "Last week", this_month: "This month", last_month: "Last month", last_90: "Last 90 days" } as const;
export type ReportPeriod = keyof typeof REPORT_PERIODS;
export interface ReportPerson { owner: string; name: string; calls: number; emails: number; meetings: number; notes: number; contacts: number; tasks_completed: number; tasks_overdue: number }
export interface CrmTeamReport { start: string; end: string; people: ReportPerson[]; stages: { value: string; label: string; count: number }[] }
export const REPORT_METRICS = [
  ["calls", "Calls"], ["emails", "Emails"], ["meetings", "Meetings"], ["notes", "Notes"], ["contacts", "Contacts added"], ["tasks_completed", "Tasks completed"], ["tasks_overdue", "Overdue now"],
] as const;

/** Calendar periods in the viewer's zone. Weeks start on Monday, like Home. */
export function reportRange(period: ReportPeriod, now = new Date(), timeZone = BUSINESS_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(now).map(part => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  const at = (offset: number) => startOfDayInTimeZone(now, timeZone, offset).toISOString();
  const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const ranges: Record<ReportPeriod, [number, number]> = {
    this_week: [-weekday, 1], last_week: [-weekday - 7, -weekday],
    this_month: [-(day - 1), 1], last_month: [-(day - 1) - previousMonthDays, -(day - 1)],
    last_90: [-89, 1],
  };
  const [start, end] = ranges[period];
  return { start: at(start), end: at(end) };
}
