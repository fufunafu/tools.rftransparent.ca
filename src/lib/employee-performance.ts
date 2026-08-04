import { sanitizePhone } from "@/lib/call-metrics";

export const PERFORMANCE_RANGES = ["today", "7d", "30d", "all"] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

export interface PerformanceStore {
  id: string;
  label: string;
}

export interface PerformanceEmployeeRow {
  id: string;
  name: string;
  email: string | null;
  email_alt: string | null;
  department: string;
  shopify_tags: string[] | null;
  active: boolean;
  location_id: string | null;
  locations?: {
    name: string;
    shopify_store_ids?: string[] | null;
  } | {
    name: string;
    shopify_store_ids?: string[] | null;
  }[] | null;
}

export interface PerformanceQuoteRow {
  id: string;
  draft_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  quote_amount: number | string;
  shopify_status: string;
  lead_status: string;
  next_followup_at: string | null;
  closed_at: string | null;
  shopify_created_at: string | null;
  first_synced_at: string;
  last_invoice_sender: string | null;
  created_by_staff: string | null;
}

export interface PerformanceFollowupRow {
  id: string;
  lead_id: string;
  logged_by: string;
  created_at: string;
}

export interface PerformanceLeadRow {
  id: string;
  email: string | null;
  phone: string | null;
}

export interface PerformanceLeadCallRow {
  id: string;
  lead_id: string;
  called_at: string;
}

export interface PerformancePhoneCallRow {
  id: string;
  call_start: string;
  from_number: string;
  to_number: string;
  direction: string;
  duration_min: number | string;
  endpoint: string | null;
}

export interface PerformanceWarehouseRow {
  employee_id: string;
  report_date: string;
  boxes_built: number | null;
  orders_packed: number | null;
  walkin_pickup: number | null;
}

export interface EmployeePerformanceInput {
  employees: PerformanceEmployeeRow[];
  quotes: PerformanceQuoteRow[];
  followups: PerformanceFollowupRow[];
  leads: PerformanceLeadRow[];
  leadCalls: PerformanceLeadCallRow[];
  phoneCalls: PerformancePhoneCallRow[];
  warehouseReports: PerformanceWarehouseRow[];
}

export interface EmployeePerformanceRecord {
  employee: {
    id: string;
    name: string;
    department: string;
    locationName: string | null;
  };
  metrics: Record<string, number>;
  previous: Record<string, number>;
  change: Record<string, number | null>;
  departmentMedian: Record<string, number>;
}

export interface EmployeePerformancePayload {
  range: PerformanceRange;
  store: PerformanceStore;
  stores: PerformanceStore[];
  currentLabel: string;
  previousLabel: string | null;
  generatedAt: string;
  employees: EmployeePerformanceRecord[];
  dataQuality: {
    matchedQuotes: number;
    unattributedQuotes: number;
    matchedFollowups: number;
    unattributedFollowups: number;
    recordedPhoneCalls: number;
    callDefinition: string;
  };
}

export interface MetricDefinition {
  key: string;
  label: string;
  shortLabel: string;
  format: "number" | "currency" | "percent" | "decimal";
  better: "higher" | "lower" | "neutral";
  departments: string[];
  description: string;
  snapshot?: boolean;
}

const QUOTE_DEPARTMENTS = ["customer_service", "sales", "management"];

export const EMPLOYEE_PERFORMANCE_METRICS: MetricDefinition[] = [
  {
    key: "quotes_sent",
    label: "Quotes sent",
    shortLabel: "Quotes",
    format: "number",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Quotes attributed to the last invoice sender, falling back to the quote creator.",
  },
  {
    key: "quoted_value",
    label: "Quoted value",
    shortLabel: "Quoted",
    format: "currency",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Total value of attributed quotes sent during the selected period.",
  },
  {
    key: "won_quotes",
    label: "Won quotes",
    shortLabel: "Won",
    format: "number",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Attributed quotes currently marked won.",
  },
  {
    key: "conversion_rate",
    label: "Quote conversion",
    shortLabel: "Conversion",
    format: "percent",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Won quotes divided by quotes sent in the selected period.",
  },
  {
    key: "followups_completed",
    label: "Follow-ups completed",
    shortLabel: "Follow-ups",
    format: "number",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Follow-up actions logged by the employee during the selected period.",
  },
  {
    key: "followups_due",
    label: "Follow-ups due",
    shortLabel: "Due",
    format: "number",
    better: "neutral",
    departments: QUOTE_DEPARTMENTS,
    description: "Open attributed quotes scheduled for follow-up during the selected period.",
  },
  {
    key: "overdue_followups",
    label: "Overdue follow-ups",
    shortLabel: "Overdue",
    format: "number",
    better: "lower",
    departments: QUOTE_DEPARTMENTS,
    description: "Open attributed quotes whose next follow-up date has passed.",
    snapshot: true,
  },
  {
    key: "called_before_quote",
    label: "Called before quote",
    shortLabel: "Called first",
    format: "number",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Attributed quotes with a recorded call attempt in the 30 days before the quote.",
  },
  {
    key: "no_call_before_quote",
    label: "No recorded call before quote",
    shortLabel: "No recorded call",
    format: "number",
    better: "lower",
    departments: QUOTE_DEPARTMENTS,
    description: "Attributed quotes with no recorded call attempt in the 30 days before the quote.",
  },
  {
    key: "call_before_quote_rate",
    label: "Call-before-quote rate",
    shortLabel: "Call first rate",
    format: "percent",
    better: "higher",
    departments: QUOTE_DEPARTMENTS,
    description: "Share of attributed quotes with a recorded call attempt before the quote.",
  },
  {
    key: "report_days",
    label: "Report days",
    shortLabel: "Report days",
    format: "number",
    better: "higher",
    departments: ["warehouse"],
    description: "Distinct days with an employee-linked warehouse daily report.",
  },
  {
    key: "boxes_built",
    label: "Boxes built",
    shortLabel: "Boxes",
    format: "number",
    better: "higher",
    departments: ["warehouse"],
    description: "Boxes built in employee-linked warehouse daily reports.",
  },
  {
    key: "orders_packed",
    label: "Orders packed",
    shortLabel: "Packed",
    format: "number",
    better: "higher",
    departments: ["warehouse"],
    description: "Orders packed in employee-linked warehouse daily reports.",
  },
  {
    key: "walkin_pickup",
    label: "Walk-in and pickup",
    shortLabel: "Walk-in",
    format: "number",
    better: "higher",
    departments: ["warehouse"],
    description: "Walk-in and pickup orders recorded by the employee.",
  },
  {
    key: "total_units",
    label: "Total activity units",
    shortLabel: "Total units",
    format: "number",
    better: "higher",
    departments: ["warehouse"],
    description: "Boxes built, orders packed, and walk-in or pickup orders combined.",
  },
  {
    key: "units_per_report_day",
    label: "Units per report day",
    shortLabel: "Units per day",
    format: "decimal",
    better: "higher",
    departments: ["warehouse"],
    description: "Total activity units divided by days with a submitted report.",
  },
];

const DAY_MS = 86_400_000;
const TORONTO_TIME_ZONE = "America/Toronto";
const CALL_LOOKBACK_DAYS = 30;

interface RangeWindow {
  today: number;
  currentStart: number | null;
  currentEnd: number;
  previousStart: number | null;
  previousEnd: number | null;
}

function torontoDayNumber(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Math.floor(Date.UTC(value("year"), value("month") - 1, value("day")) / DAY_MS);
}

function dayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return torontoDayNumber(date);
}

function dateOnlyDayNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

export function getPerformanceWindow(range: PerformanceRange, now = new Date()): RangeWindow {
  const today = torontoDayNumber(now);
  if (range === "all") {
    return {
      today,
      currentStart: null,
      currentEnd: today,
      previousStart: null,
      previousEnd: null,
    };
  }
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const currentStart = today - days + 1;
  return {
    today,
    currentStart,
    currentEnd: today,
    previousStart: currentStart - days,
    previousEnd: currentStart - 1,
  };
}

export function performanceQueryStart(range: PerformanceRange, now = new Date()): string | null {
  const window = getPerformanceWindow(range, now);
  if (window.previousStart == null) return null;
  return new Date((window.previousStart - CALL_LOOKBACK_DAYS - 1) * DAY_MS).toISOString();
}

function periodForDay(day: number | null, window: RangeWindow): "current" | "previous" | null {
  if (day == null) return null;
  if (window.currentStart == null) return day <= window.currentEnd ? "current" : null;
  if (day >= window.currentStart && day <= window.currentEnd) return "current";
  if (
    window.previousStart != null &&
    window.previousEnd != null &&
    day >= window.previousStart &&
    day <= window.previousEnd
  ) return "previous";
  return null;
}

function normalizedText(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.replace(/\s+/g, "").toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

function employeeLocationName(employee: PerformanceEmployeeRow): string | null {
  const location = Array.isArray(employee.locations) ? employee.locations[0] : employee.locations;
  return location?.name ?? null;
}

export function employeeBelongsToStore(
  employee: PerformanceEmployeeRow,
  storeId: string,
): boolean {
  const location = Array.isArray(employee.locations) ? employee.locations[0] : employee.locations;
  return location?.shopify_store_ids?.includes(storeId) ?? false;
}

interface StaffMatcher {
  match(value: string | null | undefined): string | null;
}

function createStaffMatcher(employees: PerformanceEmployeeRow[]): StaffMatcher {
  const aliases = new Map<string, Set<string>>();
  const firstNames = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, alias: string | null, employeeId: string) => {
    if (!alias) return;
    const ids = map.get(alias) ?? new Set<string>();
    ids.add(employeeId);
    map.set(alias, ids);
  };

  for (const employee of employees) {
    add(aliases, normalizedText(employee.name), employee.id);
    add(aliases, normalizedEmail(employee.email), employee.id);
    add(aliases, normalizedEmail(employee.email_alt), employee.id);
    for (const tag of employee.shopify_tags ?? []) add(aliases, normalizedText(tag), employee.id);
    add(firstNames, normalizedText(employee.name.split(/\s+/)[0]), employee.id);
  }

  return {
    match(value) {
      const text = normalizedText(value);
      const email = normalizedEmail(value);
      for (const candidate of [email, text]) {
        if (!candidate) continue;
        const exact = aliases.get(candidate);
        if (exact?.size === 1) return [...exact][0];
      }
      if (!text) return null;
      const first = text.split(" ")[0];
      const firstMatches = firstNames.get(first);
      return firstMatches?.size === 1 ? [...firstMatches][0] : null;
    },
  };
}

function emptyMetrics(): Record<string, number> {
  return Object.fromEntries(EMPLOYEE_PERFORMANCE_METRICS.map((metric) => [metric.key, 0]));
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? roundOne((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function currentAndPreviousLabel(range: PerformanceRange): { current: string; previous: string | null } {
  if (range === "today") return { current: "Today", previous: "Yesterday" };
  if (range === "7d") return { current: "Last 7 days", previous: "Previous 7 days" };
  if (range === "30d") return { current: "Last 30 days", previous: "Previous 30 days" };
  return { current: "All time", previous: null };
}

function quoteTime(quote: PerformanceQuoteRow): number | null {
  const value = quote.shopify_created_at ?? quote.first_synced_at;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function callCustomerPhone(call: PerformancePhoneCallRow): string | null {
  if (call.direction === "outbound") return sanitizePhone(call.to_number);
  const voicemail = call.endpoint?.toLowerCase().includes("vm") ?? false;
  if (call.direction === "inbound" && call.endpoint && !voicemail && Number(call.duration_min) > 0) {
    return sanitizePhone(call.from_number);
  }
  return null;
}

function hasCallBeforeQuote(
  quote: PerformanceQuoteRow,
  rawCallsByPhone: Map<string, number[]>,
  manualCallsByPhone: Map<string, number[]>,
  manualCallsByEmail: Map<string, number[]>,
): boolean {
  const time = quoteTime(quote);
  if (time == null) return false;
  const earliest = time - CALL_LOOKBACK_DAYS * DAY_MS;
  const phone = sanitizePhone(quote.customer_phone);
  const email = normalizedEmail(quote.customer_email);
  const times = [
    ...(phone ? rawCallsByPhone.get(phone) ?? [] : []),
    ...(phone ? manualCallsByPhone.get(phone) ?? [] : []),
    ...(email ? manualCallsByEmail.get(email) ?? [] : []),
  ];
  return times.some((callTime) => callTime >= earliest && callTime <= time);
}

export function buildEmployeePerformance(
  input: EmployeePerformanceInput,
  range: PerformanceRange,
  now = new Date(),
  store: PerformanceStore = { id: "all", label: "All stores" },
  stores: PerformanceStore[] = [store],
): EmployeePerformancePayload {
  const window = getPerformanceWindow(range, now);
  const employees = input.employees.filter((employee) => employee.active);
  const matcher = createStaffMatcher(employees);
  const metricsByEmployee = new Map<string, { current: Record<string, number>; previous: Record<string, number> }>();
  for (const employee of employees) {
    metricsByEmployee.set(employee.id, { current: emptyMetrics(), previous: emptyMetrics() });
  }

  const rawCallsByPhone = new Map<string, number[]>();
  for (const call of input.phoneCalls) {
    const phone = callCustomerPhone(call);
    const time = new Date(call.call_start).getTime();
    if (!phone || !Number.isFinite(time)) continue;
    rawCallsByPhone.set(phone, [...(rawCallsByPhone.get(phone) ?? []), time]);
  }

  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const manualCallsByPhone = new Map<string, number[]>();
  const manualCallsByEmail = new Map<string, number[]>();
  for (const call of input.leadCalls) {
    const lead = leadById.get(call.lead_id);
    const time = new Date(call.called_at).getTime();
    if (!lead || !Number.isFinite(time)) continue;
    const phone = sanitizePhone(lead.phone);
    const email = normalizedEmail(lead.email);
    if (phone) manualCallsByPhone.set(phone, [...(manualCallsByPhone.get(phone) ?? []), time]);
    if (email) manualCallsByEmail.set(email, [...(manualCallsByEmail.get(email) ?? []), time]);
  }

  const quoteOwnerByLeadId = new Map<string, string>();
  let matchedQuotes = 0;
  let unattributedQuotes = 0;

  for (const quote of input.quotes) {
    if (quote.shopify_status === "OPEN" || quote.shopify_status === "DELETED") continue;
    const owner = normalizedText(quote.last_invoice_sender)
      ? matcher.match(quote.last_invoice_sender)
      : matcher.match(quote.created_by_staff);
    if (owner) quoteOwnerByLeadId.set(quote.id, owner);
    const period = periodForDay(dayNumber(quote.shopify_created_at ?? quote.first_synced_at), window);
    if (!period) continue;
    if (!owner) {
      unattributedQuotes++;
      continue;
    }
    matchedQuotes++;
    const values = metricsByEmployee.get(owner)?.[period];
    if (!values) continue;
    values.quotes_sent += 1;
    values.quoted_value += Number(quote.quote_amount) || 0;
    if (quote.lead_status === "won" || quote.shopify_status === "COMPLETED") values.won_quotes += 1;
    if (hasCallBeforeQuote(quote, rawCallsByPhone, manualCallsByPhone, manualCallsByEmail)) {
      values.called_before_quote += 1;
    } else {
      values.no_call_before_quote += 1;
    }
  }

  let matchedFollowups = 0;
  let unattributedFollowups = 0;
  for (const followup of input.followups) {
    const period = periodForDay(dayNumber(followup.created_at), window);
    if (!period) continue;
    const employeeId = matcher.match(followup.logged_by);
    if (!employeeId) {
      unattributedFollowups++;
      continue;
    }
    matchedFollowups++;
    const values = metricsByEmployee.get(employeeId)?.[period];
    if (values) values.followups_completed += 1;
  }

  for (const quote of input.quotes) {
    if (quote.closed_at || quote.shopify_status === "COMPLETED" || quote.shopify_status === "DELETED") continue;
    const employeeId = quoteOwnerByLeadId.get(quote.id);
    if (!employeeId) continue;
    const dueDay = dayNumber(quote.next_followup_at);
    const period = periodForDay(dueDay, window);
    if (period) metricsByEmployee.get(employeeId)![period].followups_due += 1;
    if (dueDay != null && dueDay < window.today) {
      metricsByEmployee.get(employeeId)!.current.overdue_followups += 1;
    }
  }

  const reportDates = new Map<string, { current: Set<string>; previous: Set<string> }>();
  for (const report of input.warehouseReports) {
    const period = periodForDay(dateOnlyDayNumber(report.report_date), window);
    if (!period) continue;
    const values = metricsByEmployee.get(report.employee_id)?.[period];
    if (!values) continue;
    values.boxes_built += Number(report.boxes_built) || 0;
    values.orders_packed += Number(report.orders_packed) || 0;
    values.walkin_pickup += Number(report.walkin_pickup) || 0;
    const dates = reportDates.get(report.employee_id) ?? { current: new Set(), previous: new Set() };
    dates[period].add(report.report_date);
    reportDates.set(report.employee_id, dates);
  }

  for (const [employeeId, periods] of metricsByEmployee) {
    const dates = reportDates.get(employeeId) ?? { current: new Set(), previous: new Set() };
    for (const period of ["current", "previous"] as const) {
      const values = periods[period];
      values.report_days = dates[period].size;
      values.total_units = values.boxes_built + values.orders_packed + values.walkin_pickup;
      values.units_per_report_day = values.report_days > 0
        ? roundOne(values.total_units / values.report_days)
        : 0;
      values.conversion_rate = percent(values.won_quotes, values.quotes_sent);
      values.call_before_quote_rate = percent(values.called_before_quote, values.quotes_sent);
      values.quoted_value = Math.round(values.quoted_value * 100) / 100;
    }
  }

  const departmentGroups = new Map<string, PerformanceEmployeeRow[]>();
  for (const employee of employees) {
    departmentGroups.set(employee.department, [
      ...(departmentGroups.get(employee.department) ?? []),
      employee,
    ]);
  }

  const records: EmployeePerformanceRecord[] = employees.map((employee) => {
    const values = metricsByEmployee.get(employee.id)!;
    const departmentPeers = departmentGroups.get(employee.department) ?? [];
    const locationName = employeeLocationName(employee);
    const peers = employee.department === "warehouse" && locationName
      ? departmentPeers.filter((peer) => employeeLocationName(peer) === locationName)
      : departmentPeers;
    const departmentMedian: Record<string, number> = {};
    const change: Record<string, number | null> = {};
    for (const definition of EMPLOYEE_PERFORMANCE_METRICS) {
      departmentMedian[definition.key] = median(
        peers.map((peer) => metricsByEmployee.get(peer.id)?.current[definition.key] ?? 0),
      );
      const current = values.current[definition.key] ?? 0;
      const previous = values.previous[definition.key] ?? 0;
      change[definition.key] = range === "all" || definition.snapshot || previous === 0
        ? null
        : Math.round(((current - previous) / previous) * 100);
    }
    return {
      employee: {
        id: employee.id,
        name: employee.name,
        department: employee.department,
        locationName,
      },
      metrics: values.current,
      previous: values.previous,
      change,
      departmentMedian,
    };
  });

  const labels = currentAndPreviousLabel(range);
  return {
    range,
    store,
    stores,
    currentLabel: labels.current,
    previousLabel: labels.previous,
    generatedAt: now.toISOString(),
    employees: records.sort((left, right) => left.employee.name.localeCompare(right.employee.name)),
    dataQuality: {
      matchedQuotes,
      unattributedQuotes,
      matchedFollowups,
      unattributedFollowups,
      recordedPhoneCalls: input.phoneCalls.length + input.leadCalls.length,
      callDefinition: "Recorded outbound attempt or answered inbound call in the 30 days before the quote.",
    },
  };
}

export function metricsForDepartment(department: string): MetricDefinition[] {
  return EMPLOYEE_PERFORMANCE_METRICS.filter((metric) => metric.departments.includes(department));
}
