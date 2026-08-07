import {
  HISTORICAL_UNKNOWN_REASON,
  type LeadSource,
} from "@/lib/customer-service/leads";
import { isCallablePhone } from "@/lib/call-metrics";

export type LeadTrendRange = "7d" | "30d" | "90d" | "12m" | "all";

export interface LeadTrendPoint {
  label: string;
  fullLabel: string;
  rangeStart: string;
  rangeEnd: string;
  website: number;
  meta: number;
  total: number;
}

export interface LeadTrendSummary {
  points: LeadTrendPoint[];
  current: { total: number; website: number; meta: number };
  previous: { total: number; website: number; meta: number };
  changePct: number | null;
}

export interface LeadTrendQueryBounds {
  from: string | null;
  to: string;
}

interface LeadDateSource {
  source: LeadSource;
  submitted_at: string;
}

interface LeadFunnelRow {
  call_status: "not_called" | "no_answer" | "called";
  phone?: string | null;
  quote_number: string | null;
  outcome: "new" | "contacted" | "quoted" | "won" | "lost" | "not_applicable";
  not_applicable_reason?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

interface LeadFunnelSourceRow extends LeadFunnelRow {
  source: LeadSource;
}

export interface LeadFunnelMetrics {
  total: number;
  callEligible: number;
  attempted: number;
  quoted: number;
  won: number;
  callRate: number;
  quoteRate: number;
  conversionRate: number;
}

export type LeadFunnelMetricsBySource = Record<LeadSource, LeadFunnelMetrics>;

const DAY_MS = 86_400_000;
const TORONTO_TIME_ZONE = "America/Toronto";
const DEDUPLICATION_BUFFER_DAYS = 7;

export function leadTrendQueryBounds(
  range: LeadTrendRange | "custom",
  now = new Date(),
  customFrom = "",
  customTo = "",
): LeadTrendQueryBounds | null {
  const today = torontoDayNumber(now);
  if (range === "all") {
    return { from: null, to: dateKeyFromDay(today) };
  }

  if (range === "custom") {
    const parsedFrom = parseDateKey(customFrom);
    const parsedTo = parseDateKey(customTo);
    if (parsedFrom == null || parsedTo == null) return null;
    const start = Math.min(parsedFrom, parsedTo);
    const end = Math.max(parsedFrom, parsedTo);
    const spanDays = end - start + 1;
    return {
      from: dateKeyFromDay(start - spanDays - DEDUPLICATION_BUFFER_DAYS),
      to: dateKeyFromDay(end),
    };
  }

  if (range === "12m") {
    const currentMonth = torontoMonthNumber(now);
    const previousStart = dayNumberFromMonth(currentMonth - 23);
    return {
      from: dateKeyFromDay(previousStart - DEDUPLICATION_BUFFER_DAYS),
      to: dateKeyFromDay(today),
    };
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const previousStart = today - (days * 2) + 1;
  return {
    from: dateKeyFromDay(previousStart - DEDUPLICATION_BUFFER_DAYS),
    to: dateKeyFromDay(today),
  };
}

export function isLeadIncludedInPerformance(lead: Pick<
  LeadFunnelRow,
  "outcome" | "not_applicable_reason" | "raw_payload"
>): boolean {
  if (lead.outcome !== "not_applicable") return true;
  if (lead.not_applicable_reason === HISTORICAL_UNKNOWN_REASON) return true;
  const marker = lead.raw_payload?.historical_import;
  return typeof marker === "object" && marker !== null && !Array.isArray(marker);
}

export function calculateLeadFunnel(leads: LeadFunnelRow[]): LeadFunnelMetrics {
  const applicableLeads = leads.filter(isLeadIncludedInPerformance);
  const total = applicableLeads.length;
  const callEligible = applicableLeads.filter((lead) => (
    lead.call_status !== "not_called"
    || lead.phone === undefined
    || isCallablePhone(lead.phone)
  )).length;
  const attempted = applicableLeads.filter((lead) => lead.call_status !== "not_called").length;
  const quoted = applicableLeads.filter((lead) => Boolean(lead.quote_number?.trim())).length;
  const won = applicableLeads.filter((lead) => lead.outcome === "won").length;
  const rate = (count: number, denominator = total) => (
    denominator > 0 ? Math.round((count / denominator) * 1000) / 10 : 0
  );

  return {
    total,
    callEligible,
    attempted,
    quoted,
    won,
    callRate: rate(attempted, callEligible),
    quoteRate: rate(quoted),
    conversionRate: rate(won),
  };
}

export function calculateLeadFunnelBySource(
  leads: LeadFunnelSourceRow[],
): LeadFunnelMetricsBySource {
  return {
    website: calculateLeadFunnel(leads.filter((lead) => lead.source === "website")),
    meta: calculateLeadFunnel(leads.filter((lead) => lead.source === "meta")),
  };
}

export function buildLeadTrend(
  leads: LeadDateSource[],
  range: LeadTrendRange,
  now = new Date(),
): LeadTrendSummary {
  if (range === "all") return buildAllTimeTrend(leads, now);
  return range === "12m" ? buildMonthlyTrend(leads, now) : buildDailyTrend(leads, range, now);
}

export function buildCustomLeadTrend(
  leads: LeadDateSource[],
  from: string,
  to: string,
  now = new Date(),
): LeadTrendSummary {
  const parsedFrom = parseDateKey(from);
  const parsedTo = parseDateKey(to);
  if (parsedFrom == null || parsedTo == null) return emptySummary();

  const start = Math.min(parsedFrom, parsedTo);
  const end = Math.max(parsedFrom, parsedTo);
  const spanDays = end - start + 1;
  const previousEndTimeOfDayMs = end === torontoDayNumber(now)
    ? torontoTimeOfDayMs(now)
    : undefined;
  if (spanDays > 180) {
    return buildCustomMonthlyTrend(leads, start, end, previousEndTimeOfDayMs);
  }
  return buildDayWindow(leads, start, end, spanDays <= 45 ? 1 : 7, previousEndTimeOfDayMs);
}

export function isLeadInCustomDateRange(
  lead: Pick<LeadDateSource, "submitted_at">,
  from: string,
  to: string,
): boolean {
  const parsedFrom = parseDateKey(from);
  const parsedTo = parseDateKey(to);
  if (parsedFrom == null || parsedTo == null) return false;

  const submitted = new Date(lead.submitted_at);
  if (Number.isNaN(submitted.getTime())) return false;

  const start = Math.min(parsedFrom, parsedTo);
  const end = Math.max(parsedFrom, parsedTo);
  const submittedDay = torontoDayNumber(submitted);
  return submittedDay >= start && submittedDay <= end;
}

function buildDailyTrend(
  leads: LeadDateSource[],
  range: Exclude<LeadTrendRange, "12m" | "all">,
  now: Date,
): LeadTrendSummary {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const bucketDays = range === "90d" ? 7 : 1;
  const today = torontoDayNumber(now);
  const currentStart = today - days + 1;
  return buildDayWindow(leads, currentStart, today, bucketDays, torontoTimeOfDayMs(now));
}

function buildAllTimeTrend(leads: LeadDateSource[], now: Date): LeadTrendSummary {
  const currentEnd = torontoDayNumber(now);
  let currentStart = currentEnd;

  for (const lead of leads) {
    const submitted = new Date(lead.submitted_at);
    if (Number.isNaN(submitted.getTime())) continue;
    const day = torontoDayNumber(submitted);
    if (day <= currentEnd && day < currentStart) currentStart = day;
  }

  const spanDays = currentEnd - currentStart + 1;
  if (spanDays > 180) {
    return buildCustomMonthlyTrend(leads, currentStart, currentEnd, torontoTimeOfDayMs(now));
  }
  return buildDayWindow(leads, currentStart, currentEnd, spanDays <= 45 ? 1 : 7, torontoTimeOfDayMs(now));
}

function buildDayWindow(
  leads: LeadDateSource[],
  currentStart: number,
  currentEnd: number,
  bucketDays: number,
  previousEndTimeOfDayMs?: number,
): LeadTrendSummary {
  const days = currentEnd - currentStart + 1;
  const previousStart = currentStart - days;
  const previousEnd = currentStart - 1;
  const points: LeadTrendPoint[] = [];

  for (let start = currentStart; start <= currentEnd; start += bucketDays) {
    const end = Math.min(start + bucketDays - 1, currentEnd);
    points.push({
      label: formatDay(start),
      fullLabel: start === end ? formatDay(start, true) : `${formatDay(start, true)} to ${formatDay(end, true)}`,
      rangeStart: dateKeyFromDay(start),
      rangeEnd: dateKeyFromDay(end),
      website: 0,
      meta: 0,
      total: 0,
    });
  }

  const current = emptyCounts();
  const previous = emptyCounts();
  for (const lead of leads) {
    const submitted = new Date(lead.submitted_at);
    if (Number.isNaN(submitted.getTime())) continue;
    const day = torontoDayNumber(submitted);
    if (day >= currentStart && day <= currentEnd) {
      addSource(current, lead.source);
      const bucket = Math.floor((day - currentStart) / bucketDays);
      addSource(points[bucket], lead.source);
    } else if (
      day >= previousStart
      && day <= previousEnd
      && (
        previousEndTimeOfDayMs == null
        || day < previousEnd
        || torontoTimeOfDayMs(submitted) <= previousEndTimeOfDayMs
      )
    ) {
      addSource(previous, lead.source);
    }
  }

  return { points, current, previous, changePct: percentageChange(current.total, previous.total) };
}

function buildCustomMonthlyTrend(
  leads: LeadDateSource[],
  currentStartDay: number,
  currentEndDay: number,
  previousEndTimeOfDayMs?: number,
): LeadTrendSummary {
  const spanDays = currentEndDay - currentStartDay + 1;
  const previousStartDay = currentStartDay - spanDays;
  const previousEndDay = currentStartDay - 1;
  const firstMonth = monthNumberFromDay(currentStartDay);
  const lastMonth = monthNumberFromDay(currentEndDay);
  const points: LeadTrendPoint[] = [];

  for (let month = firstMonth; month <= lastMonth; month += 1) {
    const monthStart = dayNumberFromMonth(month);
    const monthEnd = dayNumberFromMonth(month + 1) - 1;
    points.push({
      label: formatMonth(month),
      fullLabel: formatMonth(month, true),
      rangeStart: dateKeyFromDay(Math.max(monthStart, currentStartDay)),
      rangeEnd: dateKeyFromDay(Math.min(monthEnd, currentEndDay)),
      website: 0,
      meta: 0,
      total: 0,
    });
  }

  const current = emptyCounts();
  const previous = emptyCounts();
  for (const lead of leads) {
    const submitted = new Date(lead.submitted_at);
    if (Number.isNaN(submitted.getTime())) continue;
    const day = torontoDayNumber(submitted);
    if (day >= currentStartDay && day <= currentEndDay) {
      addSource(current, lead.source);
      addSource(points[torontoMonthNumber(submitted) - firstMonth], lead.source);
    } else if (
      day >= previousStartDay
      && day <= previousEndDay
      && (
        previousEndTimeOfDayMs == null
        || day < previousEndDay
        || torontoTimeOfDayMs(submitted) <= previousEndTimeOfDayMs
      )
    ) {
      addSource(previous, lead.source);
    }
  }

  return { points, current, previous, changePct: percentageChange(current.total, previous.total) };
}

function buildMonthlyTrend(leads: LeadDateSource[], now: Date): LeadTrendSummary {
  const currentEnd = torontoMonthNumber(now);
  const currentStart = currentEnd - 11;
  const previousStart = currentStart - 12;
  const previousEnd = currentStart - 1;
  const previousEndPosition = torontoMonthPositionMs(now);
  const points: LeadTrendPoint[] = [];

  for (let month = currentStart; month <= currentEnd; month += 1) {
    const monthStart = dayNumberFromMonth(month);
    const monthEnd = dayNumberFromMonth(month + 1) - 1;
    points.push({
      label: formatMonth(month),
      fullLabel: formatMonth(month, true),
      rangeStart: dateKeyFromDay(monthStart),
      rangeEnd: dateKeyFromDay(monthEnd),
      website: 0,
      meta: 0,
      total: 0,
    });
  }

  const current = emptyCounts();
  const previous = emptyCounts();
  for (const lead of leads) {
    const submitted = new Date(lead.submitted_at);
    if (Number.isNaN(submitted.getTime())) continue;
    const month = torontoMonthNumber(submitted);
    if (month >= currentStart && month <= currentEnd) {
      addSource(current, lead.source);
      addSource(points[month - currentStart], lead.source);
    } else if (
      month >= previousStart
      && month <= previousEnd
      && (month < previousEnd || torontoMonthPositionMs(submitted) <= previousEndPosition)
    ) {
      addSource(previous, lead.source);
    }
  }

  return { points, current, previous, changePct: percentageChange(current.total, previous.total) };
}

function emptyCounts() {
  return { total: 0, website: 0, meta: 0 };
}

function emptySummary(): LeadTrendSummary {
  return {
    points: [],
    current: emptyCounts(),
    previous: emptyCounts(),
    changePct: null,
  };
}

function addSource(target: { total: number; website: number; meta: number }, source: LeadSource) {
  target[source] += 1;
  target.total += 1;
}

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function torontoDayNumber(date: Date): number {
  const { year, month, day } = torontoParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function torontoMonthNumber(date: Date): number {
  const { year, month } = torontoParts(date);
  return year * 12 + month - 1;
}

function torontoTimeOfDayMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return ((value("hour") * 60 + value("minute")) * 60 + value("second")) * 1000
    + date.getUTCMilliseconds();
}

function torontoMonthPositionMs(date: Date): number {
  return (torontoParts(date).day - 1) * DAY_MS + torontoTimeOfDayMs(date);
}

function monthNumberFromDay(dayNumber: number): number {
  const date = new Date(dayNumber * DAY_MS);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function dayNumberFromMonth(monthNumber: number): number {
  const year = Math.floor(monthNumber / 12);
  const month = monthNumber % 12;
  return Math.floor(Date.UTC(year, month, 1) / DAY_MS);
}

function dateKeyFromDay(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

function parseDateKey(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return Math.floor(date.getTime() / DAY_MS);
}

function torontoParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function formatDay(dayNumber: number, includeYear = false): string {
  return new Date(dayNumber * DAY_MS).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

function formatMonth(monthNumber: number, includeYear = false): string {
  const year = Math.floor(monthNumber / 12);
  const month = monthNumber % 12;
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}
