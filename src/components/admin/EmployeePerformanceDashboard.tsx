"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EMPLOYEE_PERFORMANCE_METRICS,
  type EmployeePerformancePayload,
  type EmployeePerformanceRecord,
  type MetricDefinition,
  type PerformanceRange,
} from "@/lib/employee-performance";

const RANGE_OPTIONS: { value: PerformanceRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

const DEPARTMENT_ORDER = ["customer_service", "warehouse", "sales", "management"];

const DEPARTMENT_LABELS: Record<string, string> = {
  customer_service: "Customer Service",
  warehouse: "Warehouse",
  sales: "Sales",
  management: "Management",
};

const FEATURED_METRICS: Record<string, string[]> = {
  customer_service: ["quotes_sent", "followups_completed", "call_before_quote_rate", "overdue_followups"],
  sales: ["quotes_sent", "quoted_value", "call_before_quote_rate", "conversion_rate"],
  management: ["quotes_sent", "followups_completed", "call_before_quote_rate", "overdue_followups"],
  warehouse: ["report_days", "total_units", "units_per_report_day", "walkin_pickup"],
};

const PRIMARY_METRIC: Record<string, string> = {
  customer_service: "quotes_sent",
  sales: "quotes_sent",
  management: "quotes_sent",
  warehouse: "total_units",
};

const numberFormatter = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

function formatMetric(definition: MetricDefinition, value: number): string {
  if (definition.format === "currency") return currencyFormatter.format(value);
  if (definition.format === "percent") return `${numberFormatter.format(value)}%`;
  return numberFormatter.format(value);
}

function employeeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}

function locationDisplayName(name: string): string {
  return name.includes(" - ") ? name.split(" - ").slice(1).join(" - ") : name;
}

function metricDefinition(key: string): MetricDefinition {
  return EMPLOYEE_PERFORMANCE_METRICS.find((metric) => metric.key === key)!;
}

function changeTone(definition: MetricDefinition, change: number): string {
  if (definition.better === "neutral" || change === 0) return "bg-slate-100 text-slate-600";
  const improved = definition.better === "higher" ? change > 0 : change < 0;
  return improved ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
}

function ChangeBadge({ definition, change }: { definition: MetricDefinition; change: number | null }) {
  if (change == null) return <span className="text-[11px] text-slate-400">No prior comparison</span>;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${changeTone(definition, change)}`}>
      {change > 0 ? "+" : ""}{change}% vs prior
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-label="Loading employee performance">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}

function SummaryCard({ label, value, note, tone }: {
  label: string;
  value: string;
  note: string;
  tone: "blue" | "emerald" | "amber" | "violet";
}) {
  const tones = {
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    violet: "bg-violet-500",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
        </div>
        <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${tones[tone]}`} aria-hidden="true" />
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function EmployeeDetailPanel({ record, payload }: {
  record: EmployeePerformanceRecord;
  payload: EmployeePerformancePayload;
}) {
  const definitions = EMPLOYEE_PERFORMANCE_METRICS.filter((metric) =>
    metric.departments.includes(record.employee.department),
  );
  const medianLabel = record.employee.department === "warehouse" && record.employee.locationName
    ? `${record.employee.locationName} median`
    : "Department median";

  return (
    <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-5 lg:self-start">
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-semibold text-white">
            {employeeInitials(record.employee.name)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-950">{record.employee.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {DEPARTMENT_LABELS[record.employee.department] ?? record.employee.department}
              {record.employee.locationName ? ` · ${record.employee.locationName}` : ""}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          {payload.currentLabel} compared with {payload.previousLabel?.toLowerCase() ?? "the employee's peer group"}.
        </p>
      </div>

      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:max-h-[660px] lg:grid-cols-1 lg:overflow-y-auto xl:grid-cols-2">
        {definitions.map((definition) => {
          const value = record.metrics[definition.key] ?? 0;
          const median = record.departmentMedian[definition.key] ?? 0;
          return (
            <div key={definition.key} className="bg-white px-4 py-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                    {definition.shortLabel}
                  </p>
                  <p className="mt-1.5 text-xl font-semibold text-slate-950 tabular-nums">
                    {formatMetric(definition, value)}
                  </p>
                </div>
                <ChangeBadge definition={definition} change={record.change[definition.key] ?? null} />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {medianLabel}: <span className="font-semibold text-slate-600">{formatMetric(definition, median)}</span>
              </p>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">{definition.description}</p>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default function EmployeePerformanceDashboard() {
  const [range, setRange] = useState<PerformanceRange>("7d");
  const [locationId, setLocationId] = useState("");
  const [payload, setPayload] = useState<EmployeePerformancePayload | null>(null);
  const [department, setDepartment] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ range });
      if (locationId) query.set("location", locationId);
      const response = await fetch(`/api/employees/performance?${query}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Employee performance could not be loaded");
      setPayload(data);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Employee performance could not be loaded");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [locationId, range]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const departments = useMemo(() => {
    if (!payload) return [];
    const available = new Set(
      payload.employees
        .map((record) => record.employee.department)
        .filter((value) => FEATURED_METRICS[value]),
    );
    return DEPARTMENT_ORDER.filter((value) => available.has(value));
  }, [payload]);

  useEffect(() => {
    if (departments.length === 0) return;
    if (!departments.includes(department)) {
      setDepartment(departments.includes("customer_service") ? "customer_service" : departments[0]);
    }
  }, [department, departments]);

  const employees = useMemo(() => {
    if (!payload || !department) return [];
    const primary = PRIMARY_METRIC[department];
    return payload.employees
      .filter((record) => record.employee.department === department)
      .sort((left, right) => {
        const difference = (right.metrics[primary] ?? 0) - (left.metrics[primary] ?? 0);
        return difference || left.employee.name.localeCompare(right.employee.name);
      });
  }, [department, payload]);

  useEffect(() => {
    if (employees.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!employees.some((record) => record.employee.id === selectedId)) {
      setSelectedId(employees[0].employee.id);
    }
  }, [employees, selectedId]);

  const selected = employees.find((record) => record.employee.id === selectedId) ?? null;
  const activeLocationId = locationId || payload?.location.id || "";
  const featured = (FEATURED_METRICS[department] ?? []).map(metricDefinition);
  const totals = useMemo(() => {
    const sum = (key: string) => employees.reduce((total, record) => total + (record.metrics[key] ?? 0), 0);
    if (department === "warehouse") {
      const reportDays = sum("report_days");
      const totalUnits = sum("total_units");
      return [
        { label: "Team activity", value: numberFormatter.format(totalUnits), note: "Recorded activity units", tone: "emerald" as const },
        { label: "Report days", value: numberFormatter.format(reportDays), note: "Employee-linked daily reports", tone: "blue" as const },
        { label: "Units per day", value: numberFormatter.format(reportDays > 0 ? totalUnits / reportDays : 0), note: "Across submitted reports", tone: "violet" as const },
        { label: "Reporting staff", value: String(employees.filter((record) => record.metrics.report_days > 0).length), note: `${employees.length} active warehouse employees`, tone: "amber" as const },
      ];
    }
    const quotes = sum("quotes_sent");
    const called = sum("called_before_quote");
    return [
      { label: "Quotes sent", value: numberFormatter.format(quotes), note: payload?.currentLabel ?? "Selected period", tone: "blue" as const },
      { label: "Quoted value", value: currencyFormatter.format(sum("quoted_value")), note: "Attributed invoice value", tone: "violet" as const },
      { label: "Follow-ups", value: numberFormatter.format(sum("followups_completed")), note: "Completed by this team", tone: "emerald" as const },
      { label: "Recorded call first", value: `${numberFormatter.format(quotes > 0 ? (called / quotes) * 100 : 0)}%`, note: "Quotes with a prior recorded call", tone: "amber" as const },
    ];
  }, [department, employees, payload?.currentLabel]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Performance filters">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.11em] text-violet-600">
              <span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden="true" />
              Manager view
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Team performance</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Compare employee activity using attributable quote, follow-up, phone, and warehouse report data for one physical location at a time.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Store location</p>
              <div className="flex max-w-[calc(100vw-4rem)] overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Performance location">
                {payload?.locations.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => setLocationId(location.id)}
                    className={`min-h-9 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${
                      activeLocationId === location.id
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {locationDisplayName(location.name)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Period</p>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Performance range">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRange(option.value)}
                    className={`min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition sm:flex-none ${
                      range === option.value
                        ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {departments.length > 0 && (
          <div className="mt-5 flex gap-2 overflow-x-auto border-t border-slate-100 pt-4" aria-label="Department filter">
            {departments.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDepartment(value)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  department === value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {DEPARTMENT_LABELS[value] ?? value}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => load()} className="w-fit text-xs font-semibold text-rose-700 hover:text-rose-900">
            Try again
          </button>
        </div>
      )}

      {(loading && !payload) || (payload && departments.length > 0 && !department) ? <LoadingState /> : payload && departments.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-800">No supported performance profiles yet</p>
          <p className="mt-1 text-xs text-slate-500">Assign active employees to Customer Service, Sales, Management, or Warehouse.</p>
        </div>
      ) : payload ? (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-500" aria-hidden="true" />
            Showing employees and activity for the <strong>{locationDisplayName(payload.location.name)}</strong> location only.
          </div>
          <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {totals.map((card) => <SummaryCard key={card.label} {...card} />)}
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(390px,0.85fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Employee comparison">
              <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                <h3 className="text-sm font-semibold text-slate-950">
                  {DEPARTMENT_LABELS[department] ?? department} comparison
                </h3>
                <p className="mt-1 text-xs text-slate-400">Ranked by {metricDefinition(PRIMARY_METRIC[department]).label.toLowerCase()}</p>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[650px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-100 text-left">
                      <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 sm:px-5">Employee</th>
                      {featured.map((definition) => (
                        <th key={definition.key} className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                          {definition.shortLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((record, index) => {
                      const active = selectedId === record.employee.id;
                      return (
                        <tr
                          key={record.employee.id}
                          onClick={() => setSelectedId(record.employee.id)}
                          className={`cursor-pointer border-b border-slate-100 last:border-0 ${active ? "bg-blue-50/70" : "hover:bg-slate-50/70"}`}
                        >
                          <td className="px-4 py-3.5 sm:px-5">
                            <button type="button" onClick={() => setSelectedId(record.employee.id)} className="flex w-full items-center gap-3 text-left">
                              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                                {index + 1}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-slate-900">{record.employee.name}</span>
                                <span className="mt-0.5 block truncate text-[10px] text-slate-400">{record.employee.locationName ?? "No location"}</span>
                              </span>
                            </button>
                          </td>
                          {featured.map((definition) => (
                            <td key={definition.key} className="px-3 py-3.5 text-right text-xs font-semibold text-slate-700 tabular-nums">
                              {formatMetric(definition, record.metrics[definition.key] ?? 0)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {employees.map((record, index) => {
                  const active = selectedId === record.employee.id;
                  return (
                    <button
                      key={record.employee.id}
                      type="button"
                      onClick={() => setSelectedId(record.employee.id)}
                      className={`w-full px-4 py-4 text-left ${active ? "bg-blue-50/70" : "bg-white"}`}
                    >
                      <span className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{record.employee.name}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {featured.slice(0, 3).map((definition) => (
                              <span key={definition.key} className="text-[10px] text-slate-500">
                                {definition.shortLabel}: <strong className="text-slate-700">{formatMetric(definition, record.metrics[definition.key] ?? 0)}</strong>
                              </span>
                            ))}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {selected && <EmployeeDetailPanel record={selected} payload={payload} />}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5" aria-label="Performance data notes">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">Call measurement</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{payload.dataQuality.callDefinition} WhatsApp, email, and in-person contact are not visible here.</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700">Attribution quality</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {payload.dataQuality.matchedQuotes} quotes and {payload.dataQuality.matchedFollowups} follow-ups matched to employees.
                  {payload.dataQuality.unattributedQuotes + payload.dataQuality.unattributedFollowups > 0
                    ? ` ${payload.dataQuality.unattributedQuotes} quotes and ${payload.dataQuality.unattributedFollowups} follow-ups remain unattributed.`
                    : " No unattributed activity was found in this comparison."}
                </p>
              </div>
            </div>
            <p className="mt-3 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
              Updated {new Date(payload.generatedAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}. Results are read-only and visible only to the owner and managers.
              {` Location scope: ${locationDisplayName(payload.location.name)}.`}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
