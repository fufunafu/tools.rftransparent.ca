"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { formatCADWhole } from "@/lib/format";
import { SalesRecordsTable } from "./SalesRecordsTable";
import type { SalesRecordDetail } from "@/lib/sales-record-details";

// Charts are split out so recharts loads on demand instead of in the
// route's initial bundle (same pattern as ShopifyCharts).
const QuotedSoldChart = dynamic(
  () => import("./EmployeeDetailCharts").then((m) => ({ default: m.QuotedSoldChart })),
  { ssr: false, loading: () => <div className="h-[260px] animate-pulse" /> }
);
const ConversionRateChart = dynamic(
  () => import("./EmployeeDetailCharts").then((m) => ({ default: m.ConversionRateChart })),
  { ssr: false, loading: () => <div className="h-[200px] animate-pulse" /> }
);

// ─── Types ──────────────────────────────────────────────────────────────────

type Period = "monthly" | "quarterly" | "yearly";

interface MonthlySnapshot {
  month: string;
  quoted: number;
  quote_count: number;
  sold: number;
  orders: number;
  aov: number;
  conversion_rate: number;
}

interface EmployeeRecord {
  id: string;
  name: string;
  department: string;
  shopify_tags?: string[] | null;
  active: boolean;
}

interface MetricsCurrent {
  quoted?: number;
  quote_count?: number;
  sold?: number;
  orders?: number;
  aov?: number;
  conversion_rate?: number;
  [key: string]: number | undefined;
}

interface Target {
  id: string;
  employee_id: string;
  metric: string;
  target_value: number;
  period_type: string;
  period_start: string;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatMetricValue(metric: string, value: number): string {
  const currency = new Set(["quoted", "sold", "revenue", "aov"]);
  const percent = new Set(["conversion_rate"]);
  if (currency.has(metric)) return formatCADWhole(value);
  if (percent.has(metric)) return `${value}%`;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function metricLabel(key: string): string {
  const labels: Record<string, string> = {
    quoted: "Quoted",
    quote_count: "Quotes",
    sold: "Sold",
    revenue: "Revenue",
    orders: "Orders",
    aov: "AOV",
    conversion_rate: "Conv. Rate",
  };
  return labels[key] ?? key;
}

function formatMonth(m: string): string {
  const [year, month] = m.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[parseInt(month) - 1]} '${year.slice(2)}`;
}

// Map target metric names to keys in metrics.current
function resolveTargetValue(metric: string, current: MetricsCurrent): number {
  if (metric in current) return current[metric] ?? 0;
  if (metric === "revenue") return current["sold"] ?? 0;
  if (metric === "quotes") return current["quote_count"] ?? 0;
  return 0;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-4">
      <p className="text-xs text-sand-400 uppercase tracking-wider">{label}</p>
      {onClick ? <button type="button" onClick={onClick} aria-label={`View ${label === "Sold" || label === "Orders" ? "orders" : "quotes"}`} className="text-xl font-semibold text-blue-700 mt-1 tabular-nums hover:underline">{value}</button> : <p className="text-xl font-semibold text-sand-900 mt-1 tabular-nums">{value}</p>}
    </div>
  );
}

function TargetRow({ target, current }: { target: Target; current: MetricsCurrent }) {
  const value = resolveTargetValue(target.metric, current);
  const pct = target.target_value > 0 ? Math.min(value / target.target_value, 1) : 0;
  const pctDisplay = target.target_value > 0
    ? Math.round((value / target.target_value) * 100)
    : 0;

  const barColor =
    pct >= 1 ? "bg-green-500" :
    pct >= 0.75 ? "bg-amber-400" :
    "bg-red-400";

  const textColor =
    pct >= 1 ? "text-green-700" :
    pct >= 0.75 ? "text-amber-700" :
    "text-red-600";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-sand-700">
          {metricLabel(target.metric)}
          <span className="ml-2 text-xs text-sand-400 font-normal capitalize">{target.period_type}</span>
        </span>
        <span className={`text-xs font-semibold ${textColor}`}>
          {formatMetricValue(target.metric, value)} / {formatMetricValue(target.metric, target.target_value)}
          {pct >= 1 && <span className="ml-1">✓</span>}
        </span>
      </div>
      <div className="h-2 bg-sand-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <p className={`text-right text-xs ${textColor}`}>{pctDisplay}%</p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function EmployeeDetail({ id }: { id: string }) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [records, setRecords] = useState<{ orders: SalesRecordDetail[]; quotes: SalesRecordDetail[] }>({ orders: [], quotes: [] });
  const [recordKind, setRecordKind] = useState<"orders" | "quotes">("orders");
  const recordsRef = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState<MetricsCurrent>({});
  const [history, setHistory] = useState<MonthlySnapshot[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [targetsError, setTargetsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    // Reset the request state when the selected reporting period changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingMetrics(true);
    setMetricsError("");
    fetch(`/api/kpi/metrics?employeeId=${id}&department=sales&period=${period}&date=${date}&includeRecords=true`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load metrics.");
        const result = json.employees?.find((entry: { employeeId: string }) => entry.employeeId === id);
        if (!result) throw new Error("No active employee metrics are available.");
        if (!controller.signal.aborted) { setCurrent(result.metrics.current ?? {}); setRecords(result.records ?? { orders: [], quotes: [] }); }
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) { setCurrent({}); setMetricsError(error.message); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingMetrics(false); });
    return () => controller.abort();
  }, [id, period, date]);

  useEffect(() => {
    const controller = new AbortController();
    // The employee ID selects a new external history request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingHistory(true);
    setHistoryError("");
    setTargetsError("");
    fetch(`/api/kpi/employees/${id}/history`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load history.");
        if (!controller.signal.aborted) {
          setEmployee(json.employee ?? null);
          setHistory(json.history ?? []);
        }
      })
      .catch((error: Error) => { if (!controller.signal.aborted) { setHistory([]); setHistoryError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingHistory(false); });
    fetch(`/api/kpi/targets?employeeId=${id}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error("Failed to load targets.");
        const seen = new Set<string>();
        const deduped = (json.targets ?? []).filter((target: Target) => {
          if (seen.has(target.metric)) return false;
          seen.add(target.metric);
          return true;
        });
        if (!controller.signal.aborted) setTargets(deduped);
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setTargetsError(error.message); });
    return () => controller.abort();
  }, [id]);

  const chartData = history.map((s) => ({
    ...s,
    month: formatMonth(s.month),
  }));

  const PERIODS: Period[] = ["monthly", "quarterly", "yearly"];

  const statCards = [
    { key: "quoted",          label: "Quoted" },
    { key: "quote_count",     label: "Quotes" },
    { key: "sold",            label: "Sold" },
    { key: "orders",          label: "Orders" },
    { key: "aov",             label: "AOV" },
    { key: "conversion_rate", label: "Conv. Rate" },
  ];

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1 text-sm text-sand-500 hover:text-sand-800 transition-colors"
        >
          ← Back to Sales
        </Link>

        <div className="flex-1 min-w-0">
          {employee ? (
            <>
              <h1 className="text-2xl font-semibold text-sand-900">{employee.name}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-sand-100 text-sand-600 capitalize">
                  {employee.department}
                </span>
                {(employee.shopify_tags ?? []).map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-mono">
                    {tag}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="h-8 w-48 bg-sand-100 rounded animate-pulse" />
          )}
        </div>

        {/* Period + date controls */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex rounded-lg border border-sand-200 overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                  period === p
                    ? "bg-sand-900 text-sand-50"
                    : "bg-white text-sand-600 hover:bg-sand-50"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Reporting date"
            value={date}
            onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
            className="text-sm border border-sand-200 rounded-lg px-3 py-1.5 text-sand-700 bg-white"
          />
        </div>
      </div>

      {(metricsError || historyError || targetsError) && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {[metricsError, historyError, targetsError].filter(Boolean).join(" ")}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ key, label }) => (
          <StatCard
            key={key}
            label={label}
            onClick={["sold", "orders", "quoted", "quote_count"].includes(key) ? () => {
              setRecordKind(key === "sold" || key === "orders" ? "orders" : "quotes");
              recordsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            } : undefined}
            value={
              loadingMetrics
                ? "Loading"
                : metricsError ? "Unavailable" : formatMetricValue(key, current[key] ?? 0)
            }
          />
        ))}
      </div>

      <p className="text-xs text-sand-500">Sold shows RF Shopify order subtotals by order date. Quotes exclude unsent drafts. Conversion is the percentage of those quotes marked completed. History shows the latest 12 months.</p>

      <section ref={recordsRef} aria-label="Employee orders and quotes" className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Orders and quotes · {period}</h2>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["orders", "quotes"] as const).map((kind) => <button key={kind} type="button" aria-pressed={recordKind === kind} onClick={() => setRecordKind(kind)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize ${recordKind === kind ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>{kind}</button>)}
          </div>
        </div>
        {loadingMetrics ? <p role="status" className="text-sm text-slate-500">Loading {recordKind}…</p> : metricsError ? <p className="text-sm text-red-700">{recordKind === "orders" ? "Orders" : "Quotes"} are unavailable.</p> :
          <SalesRecordsTable key={`${id}:${date}:${period}:${recordKind}`} records={records[recordKind]} total={current[recordKind === "orders" ? "sold" : "quoted"] ?? 0} kind={recordKind} amountLabel="Subtotal" />}
      </section>

      {/* Charts */}
      {loadingHistory ? (
        <div className="h-64 bg-sand-50 rounded-xl border border-sand-200/60 animate-pulse" />
      ) : historyError ? null : history.length === 0 ? (
        <div className="rounded-xl border border-sand-200/60 px-6 py-12 text-center text-sand-400 text-sm bg-white">
          No history data available.
        </div>
      ) : (
        <div className="space-y-6">

          {/* Quoted vs Sold */}
          <div className="bg-white rounded-xl border border-sand-200/60 p-6">
            <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-wider mb-4">
              Quoted vs Sold · last 12 months
            </h2>
            <QuotedSoldChart chartData={chartData} />
          </div>

          {/* Conversion Rate */}
          <div className="bg-white rounded-xl border border-sand-200/60 p-6">
            <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-wider mb-4">
              Conversion Rate · last 12 months
            </h2>
            <ConversionRateChart chartData={chartData} />
          </div>

        </div>
      )}

      {/* Targets */}
      {targets.length > 0 && !metricsError && !loadingMetrics && (
        <div className="bg-white rounded-xl border border-sand-200/60 p-6">
          <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-wider mb-5">
            Targets
          </h2>
          <div className="space-y-5">
            {targets.map((t) => (
              <TargetRow key={t.id} target={t} current={current} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
