import { BUSINESS_TIMEZONE, startOfDayInTimeZone } from "@/lib/dates";
import type { CrmRecord } from "./types";

export const HOME_ACTIVITIES = ["all", "emails", "calls", "meetings", "notes", "tasks"] as const;
export type HomeActivity = typeof HOME_ACTIVITIES[number];
export type HomeScope = "mine" | "team";
export interface CrmHomeData {
  asOf: string;
  timeZone: string;
  scope: HomeScope;
  dayStart: string;
  dayEnd: string;
  weekStart: string;
  tasks: { open: CrmRecord[]; completed: CrmRecord[]; openTotal: number; completedTotal: number; overdue: number };
  meetings: CrmRecord[];
  meetingTotal: number;
  activities: CrmRecord[];
  contacts: CrmRecord[];
  metrics: { contacts: number; calls: number; emails: number };
}

export function homeWindow(now: Date, timeZone = BUSINESS_TIMEZONE) {
  // Resolve calendar boundaries in the viewer's zone, including 23/25-hour days.
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const daysSinceMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  return {
    dayStart: startOfDayInTimeZone(now, timeZone).toISOString(),
    dayEnd: startOfDayInTimeZone(now, timeZone, 1).toISOString(),
    weekStart: startOfDayInTimeZone(now, timeZone, -daysSinceMonday).toISOString(),
  };
}

export function homeUrl(timeZone = BUSINESS_TIMEZONE, scope: HomeScope = "mine", activity: HomeActivity = "all") {
  return `/api/crm/home?${new URLSearchParams({ timeZone, scope, activity })}`;
}
