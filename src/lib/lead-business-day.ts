import type { Lead } from "@/lib/customer-service/leads";
import { isCallablePhone } from "@/lib/call-metrics";
import { isLeadIncludedInPerformance } from "@/lib/lead-analytics";

export const LEAD_BUSINESS_TIME_ZONE = "America/Toronto";
const localTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEAD_BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const DAY = 86_400_000;
function parts(time: number) {
  return Object.fromEntries(localTime.formatToParts(time).map(part => [part.type, Number(part.value)]));
}

/** Weekdays close at 17:00 Toronto time. Holidays are not excluded. */
export function leadCallDeadline(submittedAt: string): number | null {
  const received = Date.parse(submittedAt);
  if (!Number.isFinite(received)) return null;
  const local = parts(received);
  let day = Date.UTC(local.year, local.month - 1, local.day);
  if (local.hour >= 17) day += DAY;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY;
  // Derive the offset on the due date, so a weekend DST change is respected.
  const probe = day + 12 * 3_600_000;
  const dueLocal = parts(probe);
  const offset = Date.UTC(dueLocal.year, dueLocal.month - 1, dueLocal.day, dueLocal.hour, dueLocal.minute, dueLocal.second) - probe;
  return day + 17 * 3_600_000 - offset;
}

type CallLead = Pick<Lead, "submitted_at" | "first_call_at" | "call_status" | "phone" | "outcome" | "not_applicable_reason" | "raw_payload">;
export type CallDeadlineStatus = "onTime" | "late" | "overdue" | "pending" | "unknown" | "excluded";
export interface BusinessDayCallMetrics {
  onTime: number;
  late: number;
  overdue: number;
  pending: number;
  unknown: number;
  total: number;
  due: number;
  dueOnTime: number;
  sameDayCallRate: number | null;
}

export function callDeadlineStatus(lead: CallLead, now: number): CallDeadlineStatus {
  if (!isLeadIncludedInPerformance(lead)) return "excluded";
  if (!isCallablePhone(lead.phone) && !lead.first_call_at && lead.call_status === "not_called") return "excluded";
  const deadline = leadCallDeadline(lead.submitted_at);
  const submitted = Date.parse(lead.submitted_at);
  if (deadline == null || submitted > now) return "unknown";
  if (lead.first_call_at) {
    const firstCall = Date.parse(lead.first_call_at);
    if (!Number.isFinite(firstCall) || firstCall < submitted || firstCall > now) return "unknown";
    return firstCall <= deadline ? "onTime" : "late";
  }
  if (lead.call_status !== "not_called") return "unknown";
  return now < deadline ? "pending" : "overdue";
}

export function businessDayCallMetrics(leads: CallLead[], now: number): BusinessDayCallMetrics {
  const result: BusinessDayCallMetrics = { onTime: 0, late: 0, overdue: 0, pending: 0, unknown: 0, total: 0, due: 0, dueOnTime: 0, sameDayCallRate: null };
  for (const lead of leads) {
    const status = callDeadlineStatus(lead, now);
    if (status === "excluded") continue;
    result[status] += 1;
    result.total += 1;
    const deadline = leadCallDeadline(lead.submitted_at);
    if (status !== "unknown" && deadline != null && deadline <= now) {
      result.due += 1;
      if (status === "onTime") result.dueOnTime += 1;
    }
  }
  result.sameDayCallRate = result.due ? Math.round(result.dueOnTime / result.due * 1000) / 10 : null;
  return result;
}
