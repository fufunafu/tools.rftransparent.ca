"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import KPIEntryForm from "./KPIEntryForm";

const MarketingDashboard = lazy(() => import("./MarketingDashboard"));
const AccountingDashboard = lazy(() => import("./AccountingDashboard"));
const CustomerServiceDashboard = lazy(() => import("./CustomerServiceDashboard"));

type Period = "daily" | "weekly" | "monthly" | "yearly";
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
  discoveredTags?: { orders: string[]; drafts: string[] };
  draftsDiagnostic?: Record<string, { fetched: number; error?: string }>;
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
  yearly: "Yearly",
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


const CURRENCY_METRICS = new Set(["revenue", "sold", "quoted", "aov", "ad_spend"]);
const HOURS_METRICS = new Set(["avg_fulfillment_hours", "oldest_unfulfilled_hours"]);
const PERCENT_METRICS = new Set(["conversion_rate"]);

function formatMetricValue(metric: string, value: number) {
  if (CURRENCY_METRICS.has(metric)) return formatCurrency(value);
  if (HOURS_METRICS.has(metric)) return `${value}h`;
  if (PERCENT_METRICS.has(metric)) return `${value}%`;
  return formatNumber(value);
}

function metricLabel(key: string) {
  const labels: Record<string, string> = {
    quoted: "Quoted",
    quote_count: "Quotes",
    sold: "Sold",
    revenue: "Revenue",
    orders: "Orders",
    aov: "AOV",
    conversion_rate: "Conv. Rate",
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

function metricTooltip(key: string): string {
  const tips: Record<string, string> = {
    quoted:                  "Total dollar value of draft orders (quotes) created by this employee in the period, matched by their Shopify tag.",
    quote_count:             "Number of draft orders (quotes) created by this employee in the period.",
    sold:                    "Total revenue from completed orders attributed to this employee via their Shopify tag. Calculated as order subtotal minus any shipping cost and export tariff metafields.",
    revenue:                 "Same as Sold — net revenue from completed orders attributed to this employee.",
    orders:                  "Number of completed orders attributed to this employee via their Shopify tag.",
    aov:                     "Average Order Value — Sold ÷ Orders. Shows the typical size of each transaction.",
    conversion_rate:         "Conversion Rate — Sold ÷ Quoted, as a percentage. What share of quoted dollars closed as actual sales in the period.",
    open_orders:             "Orders that have been placed but not yet fulfilled.",
    fulfilled_orders:        "Orders that have been fully fulfilled in the period.",
    avg_fulfillment_hours:   "Average number of hours between an order being placed and it being fulfilled.",
    oldest_unfulfilled_hours:"How many hours old the oldest still-unfulfilled order is right now.",
    tickets_resolved:        "Number of customer service tickets closed in the period.",
    response_time:           "Average time (in hours) to send a first reply to a new customer ticket.",
    satisfaction:            "Average customer satisfaction score from post-ticket surveys.",
  };
  return tips[key] || "";
}

function MetricTooltip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="relative group inline-flex items-center ml-1">
      <span className="w-3.5 h-3.5 rounded-full bg-sand-200 text-sand-500 text-[9px] font-bold flex items-center justify-center cursor-default leading-none">
        ?
      </span>
      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 rounded-lg bg-sand-900 text-sand-50 text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 normal-case font-normal tracking-normal text-left shadow-lg">
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-sand-900" />
        {text}
      </span>
    </span>
  );
}

// --- Employee table tab (Sales, Warehouse, Customer Service) ---
export function EmployeeTab({ department }: { department: string }) {
  const [period, setPeriod] = useState<Period>(department === "sales" ? "yearly" : "daily");
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
        key,
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
          {(["daily", "weekly", "monthly", "yearly"] as Period[]).map((p) => (
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

        {department === "warehouse" && (
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

      {/* Drafts diagnostic — shows per-store draft order fetch results */}
      {department === "sales" && data?.draftsDiagnostic && (
        <details className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800" open>
          <summary className="cursor-pointer font-medium">
            Draft orders fetched (quoted metric diagnostic)
          </summary>
          <div className="mt-2 space-y-1 font-mono">
            {Object.entries(data.draftsDiagnostic).map(([store, info]) => (
              <p key={store}>
                <span className="font-semibold">{store}:</span> {info.fetched} drafts fetched
                {info.error && <span className="text-red-700"> · error: {info.error}</span>}
              </p>
            ))}
          </div>
        </details>
      )}

      {/* Tags hint — shown when the period has orders but employees lack shopify_tags */}
      {department === "sales" && data?.discoveredTags && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">
            Tags found on orders this period — use these to configure Shopify Tags per employee
          </summary>
          <div className="mt-2 space-y-1">
            {data.discoveredTags.orders.length > 0 && (
              <p><span className="font-medium">Orders:</span> {data.discoveredTags.orders.join(", ")}</p>
            )}
            {data.discoveredTags.drafts.length > 0 && (
              <p><span className="font-medium">Quotes:</span> {data.discoveredTags.drafts.join(", ")}</p>
            )}
          </div>
        </details>
      )}

      {/* Summary cards */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-sand-200/60 p-4"
            >
              <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
                {card.label}
                <MetricTooltip text={metricTooltip(card.key)} />
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
                  {department !== "sales" && (
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                      Location
                    </th>
                  )}
                  {allMetricKeys.map((key) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400 cursor-pointer hover:text-sand-700 select-none"
                    >
                      <span className="inline-flex items-center">
                        {metricLabel(key)}
                        <MetricTooltip text={metricTooltip(key)} />
                      </span>
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
                      colSpan={(department !== "sales" ? 2 : 1) + allMetricKeys.length}
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
                    {department !== "sales" && (
                      <td className="px-4 py-3 text-sand-500">
                        {emp.locationName}
                      </td>
                    )}
                    {allMetricKeys.map((key) => (
                      <td key={key} className="px-4 py-3 text-right tabular-nums text-sand-900">
                        {formatMetricValue(key, emp.metrics.current[key] ?? 0)}
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
