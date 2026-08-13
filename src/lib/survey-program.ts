export type SurveyType = "weekly" | "quarterly" | "onboarding" | "exit" | "targeted";
export type SurveyPrivacyModel = "named" | "confidential_aggregate" | "restricted_named";
export type SurveyResponseType = "scale" | "text" | "boolean" | "single_choice";

export interface SurveyOption {
  value: number | string | boolean;
  label: string;
}

export interface SurveyQuestionSnapshot {
  id: string;
  metric_key: string;
  prompt: string;
  response_type: SurveyResponseType;
  options: SurveyOption[] | null;
  dimension: string | null;
  required: boolean;
  display_order: number;
}

export interface SurveyAnswerInput {
  metric_key: string;
  value: number | string | boolean;
}

export interface SurveyAutomationTasks {
  sendPeriodicCampaign: boolean;
  sendReminders: boolean;
  closeExpiredCampaigns: boolean;
  sendLifecycleCampaigns: boolean;
  purgeExpiredWrittenAnswers: boolean;
}

export interface SurveyWindow {
  sendAt: Date;
  opensAt: Date;
  reminderAt: Date;
  closesAt: Date;
  isQuarterlyWeek: boolean;
}

export interface MetricAggregate {
  count: number;
  average: number | null;
  median: number | null;
  distribution: Record<string, number>;
}

const TORONTO_TIME_ZONE = "America/Toronto";
const QUARTERLY_MONTHS = new Set([1, 4, 7, 10]);
const MAX_TEXT_LENGTH = 4000;

function localParts(date: Date, timeZone = TORONTO_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

/** Convert a wall-clock time in Toronto to its UTC instant, including DST. */
export function torontoDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(candidate);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desired - actualAsUtc;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

function addCalendarDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function isFirstThursdayOfQuarter(date: Date): boolean {
  const parts = localParts(date);
  return parts.weekday === "Thu" && parts.day <= 7 && QUARTERLY_MONTHS.has(parts.month);
}

export function surveyWindowForThursday(date: Date): SurveyWindow {
  const parts = localParts(date);
  if (parts.weekday !== "Thu") {
    throw new Error("Survey windows must start on a Thursday");
  }
  const monday = addCalendarDays(parts, 4);
  const tuesday = addCalendarDays(parts, 5);
  const sendAt = torontoDateTimeToUtc(parts.year, parts.month, parts.day, 15);
  return {
    sendAt,
    opensAt: sendAt,
    reminderAt: torontoDateTimeToUtc(monday.year, monday.month, monday.day, 9),
    closesAt: torontoDateTimeToUtc(tuesday.year, tuesday.month, tuesday.day, 9),
    isQuarterlyWeek: parts.day <= 7 && QUARTERLY_MONTHS.has(parts.month),
  };
}

export function getSurveyAutomationTasks(now = new Date()): SurveyAutomationTasks {
  const parts = localParts(now);
  return {
    sendPeriodicCampaign: parts.weekday === "Thu" && parts.hour === 15,
    sendReminders: parts.weekday === "Mon" && parts.hour === 9,
    closeExpiredCampaigns: parts.weekday === "Tue" && parts.hour === 9,
    sendLifecycleCampaigns: parts.hour === 9,
    purgeExpiredWrittenAnswers: parts.hour === 9,
  };
}

export function torontoDateKey(date = new Date()): string {
  const parts = localParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function validateSurveyAnswers(
  questions: SurveyQuestionSnapshot[],
  value: unknown,
): SurveyAnswerInput[] {
  if (!Array.isArray(value)) throw new Error("Answers must be an array");

  const rawByMetric = new Map<string, unknown>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each answer must identify a question and value");
    }
    const metricKey = "metric_key" in raw ? raw.metric_key : null;
    if (typeof metricKey !== "string" || !metricKey) {
      throw new Error("Each answer must identify a question");
    }
    if (rawByMetric.has(metricKey)) throw new Error(`Duplicate answer for ${metricKey}`);
    rawByMetric.set(metricKey, "value" in raw ? raw.value : undefined);
  }

  const knownMetrics = new Set(questions.map((question) => question.metric_key));
  for (const metric of rawByMetric.keys()) {
    if (!knownMetrics.has(metric)) throw new Error(`Unknown survey question: ${metric}`);
  }

  return questions.flatMap((question): SurveyAnswerInput[] => {
    const raw = rawByMetric.get(question.metric_key);
    const absent = raw === undefined || raw === null || (typeof raw === "string" && !raw.trim());
    if (absent) {
      if (question.required) throw new Error(`Please answer: ${question.prompt}`);
      return [];
    }

    if (question.response_type === "scale") {
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        throw new Error(`Choose one option for: ${question.prompt}`);
      }
      const allowed = question.options?.some((option) => option.value === raw) ?? false;
      if (!allowed) throw new Error(`Choose a valid option for: ${question.prompt}`);
      return [{ metric_key: question.metric_key, value: raw }];
    }

    if (question.response_type === "boolean") {
      if (typeof raw !== "boolean") throw new Error(`Choose yes or no for: ${question.prompt}`);
      return [{ metric_key: question.metric_key, value: raw }];
    }

    if (question.response_type === "single_choice") {
      if (typeof raw !== "string") throw new Error(`Choose one option for: ${question.prompt}`);
      const allowed = question.options?.some((option) => option.value === raw) ?? false;
      if (!allowed) throw new Error(`Choose a valid option for: ${question.prompt}`);
      return [{ metric_key: question.metric_key, value: raw }];
    }

    if (typeof raw !== "string") throw new Error(`Enter text for: ${question.prompt}`);
    const normalized = raw.trim();
    if (normalized.length > MAX_TEXT_LENGTH) {
      throw new Error(`Keep your answer under ${MAX_TEXT_LENGTH.toLocaleString()} characters`);
    }
    return [{ metric_key: question.metric_key, value: normalized }];
  });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function aggregateMetric(values: number[]): MetricAggregate {
  const distribution: Record<string, number> = {};
  for (const value of values) {
    const key = String(value);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }
  return {
    count: values.length,
    average: values.length > 0
      ? Math.round((values.reduce((sum, current) => sum + current, 0) / values.length) * 100) / 100
      : null,
    median: median(values),
    distribution,
  };
}

export function materiallyBelowBaseline(current: number | null, baseline: number | null): boolean {
  return current !== null && baseline !== null && baseline - current >= 0.75;
}

export function responseRateDropped(current: number | null, baseline: number | null): boolean {
  return current !== null && baseline !== null && baseline - current >= 20;
}

const THEME_STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "been", "before", "being", "better",
  "could", "does", "doing", "from", "have", "here", "into", "just", "more", "much",
  "need", "only", "other", "really", "should", "some", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "those", "very", "want", "week", "what",
  "when", "where", "which", "while", "with", "would", "your", "work", "working",
]);

export function recurringFeedbackThemes(comments: string[], limit = 8) {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    const words = new Set(
      comment
        .toLowerCase()
        .replace(/[^a-z0-9' -]/g, " ")
        .split(/\s+/)
        .map((word) => word.replace(/^'+|'+$/g, ""))
        .filter((word) => word.length >= 4 && !THEME_STOP_WORDS.has(word)),
    );
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([theme, mentions]) => ({ theme, mentions }));
}

export function shouldExposeGroup(responseCount: number, minimum = 5): boolean {
  return responseCount >= minimum;
}
