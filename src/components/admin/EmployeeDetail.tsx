"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { formatCADWhole } from "@/lib/format";

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-4">
      <p className="text-xs text-sand-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-semibold text-sand-900 mt-1 tabular-nums">{value}</p>
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
  const [current, setCurrent] = useState<MetricsCurrent>({});
  const [history, setHistory] = useState<MonthlySnapshot[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);

  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");

  // Fetch current-period metrics (re-runs when period/date changes)
  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const res = await fetch(
        `/api/kpi/metrics?employeeId=${id}&department=sales&period=${period}&date=${date}`
      );
      const json = await res.json();
      if (json.employees?.length) {
        setCurrent(json.employees[0].metrics.current ?? {});
      } else {
        setCurrent({});
      }
    } catch {
      setError("Failed to load metrics.");
    } finally {
      setLoadingMetrics(false);
    }
  }, [id, period, date]);

  // Fetch history + targets (once on mount)
  const fetchHistoryAndTargets = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const [histRes, targRes] = await Promise.all([
        fetch(`/api/kpi/employees/${id}/history`),
        fetch(`/api/kpi/targets?employeeId=${id}`),
      ]);
      const [histJson, targJson] = await Promise.all([histRes.json(), targRes.json()]);

      if (histJson.employee) setEmployee(histJson.employee);
      setHistory(histJson.history ?? []);

      // Keep only the most recent target per metric
      const seen = new Set<string>();
      const deduped: Target[] = [];
      for (const t of (targJson.targets ?? [])) {
        if (!seen.has(t.metric)) {
          seen.add(t.metric);
          deduped.push(t);
        }
      }
      setTargets(deduped);
    } catch {
      setError("Failed to load history or targets.");
    } finally {
      setLoadingHistory(false);
    }
  }, [id]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);
  useEffect(() => { fetchHistoryAndTargets(); }, [fetchHistoryAndTargets]);

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
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm border border-sand-200 rounded-lg px-3 py-1.5 text-sand-700 bg-white"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ key, label }) => (
          <StatCard
            key={key}
            label={label}
            value={
              loadingMetrics
                ? "—"
                : formatMetricValue(key, current[key] ?? 0)
            }
          />
        ))}
      </div>

      {/* Charts */}
      {loadingHistory ? (
        <div className="h-64 bg-sand-50 rounded-xl border border-sand-200/60 animate-pulse" />
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-sand-200/60 px-6 py-12 text-center text-sand-400 text-sm bg-white">
          No history data available.
        </div>
      ) : (
        <div className="space-y-6">

          {/* Quoted vs Sold */}
          <div className="bg-white rounded-xl border border-sand-200/60 p-6">
            <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-wider mb-4">
              Quoted vs Sold — last 12 months
            </h2>
            <QuotedSoldChart chartData={chartData} />
          </div>

          {/* Conversion Rate */}
          <div className="bg-white rounded-xl border border-sand-200/60 p-6">
            <h2 className="text-sm font-semibold text-sand-700 uppercase tracking-wider mb-4">
              Conversion Rate — last 12 months
            </h2>
            <ConversionRateChart chartData={chartData} />
          </div>

        </div>
      )}

      {/* Targets */}
      {targets.length > 0 && (
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
