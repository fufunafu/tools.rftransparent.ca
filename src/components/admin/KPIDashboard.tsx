"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import KPIEntryForm from "./KPIEntryForm";

const MarketingDashboard = lazy(() => import("./MarketingDashboard"));
const AccountingDashboard = lazy(() => import("./AccountingDashboard"));
const CustomerServiceDashboard = lazy(() => import("./CustomerServiceDashboard"));

type Period = "daily" | "weekly" | "monthly";
type Tab = "sales" | "marketing" | "warehouse" | "customer_service" | "accounting";

interface Location {
  id: string;
  name: string;
}

interface EmployeeMetrics {
  employeeId: string;
  employeeName: string;
  department: string;
  locationName: string;
  metrics: {
    current: Record<string, number>;
    previous: Record<string, number>;
    change: Record<string, number | null>;
  };
}

interface MetricsResponse {
  employees: EmployeeMetrics[];
  summary: Record<string, number>;
  period: Period;
  dateRange: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
}

const TABS: { value: Tab; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "warehouse", label: "Warehouse" },
  { value: "customer_service", label: "Customer Service" },
  { value: "accounting", label: "Accounting" },
];

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sand-300">&mdash;</span>;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium ${
        isPositive
          ? "text-green-700"
          : isNegative
            ? "text-red-600"
            : "text-sand-400"
      }`}
    >
      {isPositive ? "+" : ""}
      {value}%
    </span>
  );
}

const CURRENCY_METRICS = new Set(["revenue", "aov", "ad_spend"]);
const HOURS_METRICS = new Set(["avg_fulfillment_hours", "oldest_unfulfilled_hours"]);

function formatMetricValue(metric: string, value: number) {
  if (CURRENCY_METRICS.has(metric)) return formatCurrency(value);
  if (HOURS_METRICS.has(metric)) return `${value}h`;
  return formatNumber(value);
}

function metricLabel(key: string) {
  const labels: Record<string, string> = {
    revenue: "Revenue",
    orders: "Orders",
    aov: "AOV",
    open_orders: "Open Orders",
    fulfilled_orders: "Fulfilled",
    avg_fulfillment_hours: "Avg Fulfillment",
    oldest_unfulfilled_hours: "Oldest Open",
    tickets_resolved: "Tickets Resolved",
    response_time: "Avg Response Time",
    satisfaction: "Satisfaction",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Employee table tab (Sales, Warehouse, Customer Service) ---
export function EmployeeTab({ department }: { department: string }) {
  const [period, setPeriod] = useState<Period>("daily");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showEntryForm, setShowEntryForm] = useState(false);

  const isManual = department === "customer_service";

  useEffect(() => {
    fetch("/api/kpi/locations")
      .then((r) => r.json())
      .then((d) => setLocations(d))
      .catch(() => {});
  }, []);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ period, date, department });
      if (locationId) params.set("locationId", locationId);
      const res = await fetch(`/api/kpi/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to load metrics");
      const json: MetricsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [period, date, department, locationId]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const allMetricKeys = data
    ? [...new Set(data.employees.flatMap((e) => Object.keys(e.metrics.current)))]
    : [];

  const activeSortBy = sortBy || allMetricKeys[0] || "";

  const sortedEmployees = data
    ? [...data.employees].sort((a, b) => {
        const aVal = a.metrics.current[activeSortBy] ?? 0;
        const bVal = b.metrics.current[activeSortBy] ?? 0;
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
      })
    : [];

  const handleSort = (key: string) => {
    if (activeSortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const summaryCards = data
    ? allMetricKeys.slice(0, 4).map((key) => ({
        label: metricLabel(key),
        value: formatMetricValue(key, data.summary[key] ?? 0),
      }))
    : [];

  const topPerformer =
    sortedEmployees.length > 0 && activeSortBy ? sortedEmployees[0] : null;

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-sand-200 overflow-hidden">
          {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                period === p
                  ? "bg-sand-900 text-sand-50"
                  : "bg-white text-sand-600 hover:bg-sand-50"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white"
        />

        {(department === "sales" || department === "warehouse") && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isManual && (
            <button
              onClick={() => setShowEntryForm(true)}
              className="px-4 py-2 text-sm text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors"
            >
              + Add KPI Entry
            </button>
          )}
          <button
            onClick={loadMetrics}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data?.dateRange && (
        <p className="text-xs text-sand-400">
          Showing: {data.dateRange.current.from} &rarr; {data.dateRange.current.to}
          {" · "}
          Compared to: {data.dateRange.previous.from} &rarr; {data.dateRange.previous.to}
        </p>
      )}

      {/* Summary cards */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-sand-200/60 p-4"
            >
              <p className="text-xs text-sand-400 uppercase tracking-wider">
                {card.label}
              </p>
              <p className="text-xl font-semibold text-sand-900 mt-1">
                {card.value}
              </p>
            </div>
          ))}
          {topPerformer && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-4">
              <p className="text-xs text-sand-400 uppercase tracking-wider">
                Top Performer
              </p>
              <p className="text-lg font-semibold text-sand-900 mt-1 truncate">
                {topPerformer.employeeName}
              </p>
              <p className="text-xs text-sand-400">
                {formatMetricValue(activeSortBy, topPerformer.metrics.current[activeSortBy] ?? 0)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Employee table */}
      {!loading && data && (
        <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                    Employee
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                    Location
                  </th>
                  {allMetricKeys.map((key) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400 cursor-pointer hover:text-sand-700 select-none"
                    >
                      {metricLabel(key)}
                      {activeSortBy === key && (
                        <span className="ml-1">
                          {sortDir === "desc" ? "\u2193" : "\u2191"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.length === 0 && (
                  <tr>
                    <td
                      colSpan={2 + allMetricKeys.length}
                      className="px-4 py-8 text-center text-sand-400"
                    >
                      No employees found for this department.{" "}
                      <a
                        href="/employees"
                        className="text-accent underline"
                      >
                        Manage employees
                      </a>
                    </td>
                  </tr>
                )}
                {sortedEmployees.map((emp) => (
                  <tr
                    key={emp.employeeId}
                    onClick={() =>
                      setExpandedRow(
                        expandedRow === emp.employeeId ? null : emp.employeeId
                      )
                    }
                    className="border-b border-sand-50 hover:bg-sand-50/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-sand-900">
                      {emp.employeeName}
                    </td>
                    <td className="px-4 py-3 text-sand-500">
                      {emp.locationName}
                    </td>
                    {allMetricKeys.map((key) => (
                      <td key={key} className="px-4 py-3 text-right">
                        <span className="text-sand-900">
                          {formatMetricValue(key, emp.metrics.current[key] ?? 0)}
                        </span>
                        <span className="ml-2">
                          <ChangeBadge value={emp.metrics.change[key] ?? null} />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-12 text-sand-400">Loading KPIs...</div>
      )}

      {showEntryForm && (
        <KPIEntryForm
          onSave={() => {
            setShowEntryForm(false);
            loadMetrics();
          }}
          onCancel={() => setShowEntryForm(false)}
        />
      )}
    </div>
  );
}


// --- Main KPI Dashboard ---
export default function KPIDashboard() {
  const [tab, setTab] = useState<Tab>("sales");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex border-b border-sand-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-5 py-3 text-sm font-medium transition-colors relative ${
              tab === t.value
                ? "text-sand-900"
                : "text-sand-400 hover:text-sand-600"
            }`}
          >
            {t.label}
            {tab === t.value && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sand-900 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <Suspense fallback={<div className="text-center py-12 text-sand-400">Loading...</div>}>
        {tab === "marketing" && <MarketingDashboard />}
        {tab === "accounting" && <AccountingDashboard />}
        {(tab === "sales" || tab === "warehouse") && (
          <EmployeeTab key={tab} department={tab} />
        )}
        {tab === "customer_service" && <CustomerServiceDashboard />}
      </Suspense>
    </div>
  );
}
