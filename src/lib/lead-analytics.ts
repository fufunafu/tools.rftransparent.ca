import type { LeadSource } from "@/lib/customer-service/leads";

export type LeadTrendRange = "30d" | "90d" | "12m";

export interface LeadTrendPoint {
  label: string;
  fullLabel: string;
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

interface LeadDateSource {
  source: LeadSource;
  submitted_at: string;
}

const DAY_MS = 86_400_000;
const TORONTO_TIME_ZONE = "America/Toronto";

export function buildLeadTrend(
  leads: LeadDateSource[],
  range: LeadTrendRange,
  now = new Date(),
): LeadTrendSummary {
  return range === "12m" ? buildMonthlyTrend(leads, now) : buildDailyTrend(leads, range, now);
}

export function buildCustomLeadTrend(
  leads: LeadDateSource[],
  from: string,
  to: string,
): LeadTrendSummary {
  const parsedFrom = parseDateKey(from);
  const parsedTo = parseDateKey(to);
  if (parsedFrom == null || parsedTo == null) return emptySummary();

  const start = Math.min(parsedFrom, parsedTo);
  const end = Math.max(parsedFrom, parsedTo);
  const spanDays = end - start + 1;
  if (spanDays > 180) return buildCustomMonthlyTrend(leads, start, end);
  return buildDayWindow(leads, start, end, spanDays <= 45 ? 1 : 7);
}

function buildDailyTrend(
  leads: LeadDateSource[],
  range: Exclude<LeadTrendRange, "12m">,
  now: Date,
): LeadTrendSummary {
  const days = range === "30d" ? 30 : 90;
  const bucketDays = range === "30d" ? 1 : 7;
  const today = torontoDayNumber(now);
  const currentStart = today - days + 1;
  return buildDayWindow(leads, currentStart, today, bucketDays);
}

function buildDayWindow(
  leads: LeadDateSource[],
  currentStart: number,
  currentEnd: number,
  bucketDays: number,
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
    } else if (day >= previousStart && day <= previousEnd) {
      addSource(previous, lead.source);
    }
  }

  return { points, current, previous, changePct: percentageChange(current.total, previous.total) };
}

function buildCustomMonthlyTrend(
  leads: LeadDateSource[],
  currentStartDay: number,
  currentEndDay: number,
): LeadTrendSummary {
  const spanDays = currentEndDay - currentStartDay + 1;
  const previousStartDay = currentStartDay - spanDays;
  const previousEndDay = currentStartDay - 1;
  const firstMonth = monthNumberFromDay(currentStartDay);
  const lastMonth = monthNumberFromDay(currentEndDay);
  const points: LeadTrendPoint[] = [];

  for (let month = firstMonth; month <= lastMonth; month += 1) {
    points.push({
      label: formatMonth(month),
      fullLabel: formatMonth(month, true),
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
    } else if (day >= previousStartDay && day <= previousEndDay) {
      addSource(previous, lead.source);
    }
  }

  return { points, current, previous, changePct: percentageChange(current.total, previous.total) };
}

function buildMonthlyTrend(leads: LeadDateSource[], now: Date): LeadTrendSummary {
  const currentMonth = torontoMonthNumber(now);
  const currentStart = currentMonth - 11;
  const previousStart = currentStart - 12;
  const previousEnd = currentStart - 1;
  const points: LeadTrendPoint[] = [];

  for (let month = currentStart; month <= currentMonth; month += 1) {
    points.push({
      label: formatMonth(month),
      fullLabel: formatMonth(month, true),
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
    if (month >= currentStart && month <= currentMonth) {
      addSource(current, lead.source);
      addSource(points[month - currentStart], lead.source);
    } else if (month >= previousStart && month <= previousEnd) {
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

function monthNumberFromDay(dayNumber: number): number {
  const date = new Date(dayNumber * DAY_MS);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
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
