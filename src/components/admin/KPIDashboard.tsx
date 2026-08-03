"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import KPIEntryForm from "./KPIEntryForm";
import { formatCADWhole } from "@/lib/format";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type Period = "daily" | "weekly" | "monthly" | "yearly";

interface Location {
  id: string;
  name: string;
}

interface EmployeeMetrics {
  employeeId: string;
  employeeName: string;
  department: string;
  locationName: string;
  shopifyTags?: string[];
  metrics: {
    current: Record<string, number>;
    previous: Record<string, number>;
    change: Record<string, number | null>;
  };
}

interface UnassignedItem {
  id: string;
  name: string;
  createdAt: string;
  amount: number;
  tags: string[];
  type: "order" | "draft";
}

interface MetricsResponse {
  employees: EmployeeMetrics[];
  summary: Record<string, number>;
  period: Period;
  dateRange: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
  };
  unassignedOrders?: UnassignedItem[];
  discoveredTags?: { orders: string[]; drafts: string[] };
  draftsDiagnostic?: Record<string, { fetched: number; error?: string }>;
}

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}


const CURRENCY_METRICS = new Set(["revenue", "sold", "quoted", "aov", "ad_spend"]);
const HOURS_METRICS = new Set(["avg_fulfillment_hours", "oldest_unfulfilled_hours"]);
const PERCENT_METRICS = new Set(["conversion_rate"]);

function formatMetricValue(metric: string, value: number) {
  if (CURRENCY_METRICS.has(metric)) return formatCADWhole(value);
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
    quoted:                  "Total dollar value of draft orders sent or closed in the period, attributed by Shopify tag. OPEN (unsent) drafts are excluded — only invoices sent to the customer and completed (converted) quotes are counted.",
    quote_count:             "Number of draft orders sent or closed in the period (excludes OPEN / unsent drafts).",
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
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  if (!text) return null;

  const show = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 8, left: r.left + r.width / 2 });
  };
  const hide = () => setCoords(null);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="w-3.5 h-3.5 rounded-full bg-sand-200 text-sand-500 text-[9px] font-bold inline-flex items-center justify-center cursor-default leading-none ml-1 shrink-0"
      >
        ?
      </span>
      {coords && createPortal(
        <div
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateX(-50%)", zIndex: 9999 }}
          className="w-56 rounded-lg bg-sand-900 text-sand-50 text-xs px-3 py-2 shadow-lg pointer-events-none normal-case font-normal tracking-normal text-left"
        >
          <span
            style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)" }}
            className="border-4 border-transparent border-b-sand-900"
          />
          {text}
        </div>,
        document.body
      )}
    </>
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

  const loadMetrics = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      // Silent mode skips the loading state so background refreshes repaint
      // the table without flashing the spinner.
      if (!silent) {
        setLoading(true);
        setError("");
      }
      try {
        const params = new URLSearchParams({ period, date, department });
        if (locationId) params.set("locationId", locationId);
        const res = await fetch(`/api/kpi/metrics?${params}`);
        if (!res.ok) throw new Error("Failed to load metrics");
        const json: MetricsResponse = await res.json();
        setData(json);
        setError("");
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [period, date, department, locationId]
  );

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useAutoRefresh(() => loadMetrics({ silent: true }), { intervalMs: 90_000 });

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
            onClick={() => loadMetrics()}
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
                      <Link
                        href="/employees"
                        className="text-accent underline"
                      >
                        Manage employees
                      </Link>
                    </td>
                  </tr>
                )}
                {sortedEmployees.map((emp) => (
                  <React.Fragment key={emp.employeeId}>
                    <tr
                      onClick={() =>
                        setExpandedRow(
                          expandedRow === emp.employeeId ? null : emp.employeeId
                        )
                      }
                      className="border-b border-sand-50 hover:bg-sand-50/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-sand-900">
                        <span className="inline-flex items-center gap-1">
                          {emp.employeeId === "__unassigned__" ? (
                            <span className="inline-flex items-center gap-1">
                              {emp.employeeName}
                              <span className="text-sand-400 text-xs">{expandedRow === emp.employeeId ? "▲" : "▼"}</span>
                            </span>
                          ) : emp.employeeName}
                          {emp.shopifyTags && emp.shopifyTags.length > 0 && (
                            <MetricTooltip
                              text={`Shopify tag filter: ${emp.shopifyTags.join(", ")}`}
                            />
                          )}
                        </span>
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
                    {emp.employeeId === "__unassigned__" && expandedRow === emp.employeeId && data?.unassignedOrders && (
                      <tr key="__unassigned_detail__">
                        <td colSpan={1 + allMetricKeys.length} className="bg-sand-50 px-4 py-4">
                          <p className="text-xs font-semibold text-sand-500 uppercase tracking-wider mb-3">
                            Unassigned orders &amp; quotes this period — sorted by amount
                          </p>
                          {data.unassignedOrders.length === 0 ? (
                            <p className="text-sm text-sand-400">None</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-sand-400 border-b border-sand-200">
                                    <th className="text-left pb-2 pr-4 font-medium">Name</th>
                                    <th className="text-left pb-2 pr-4 font-medium">Type</th>
                                    <th className="text-left pb-2 pr-4 font-medium">Date</th>
                                    <th className="text-right pb-2 pr-4 font-medium">Amount</th>
                                    <th className="text-left pb-2 font-medium">Tags</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {data.unassignedOrders.map((item) => (
                                    <tr key={item.id} className="border-b border-sand-100 last:border-0">
                                      <td className="py-2 pr-4 font-mono text-sand-700">{item.name}</td>
                                      <td className="py-2 pr-4">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${item.type === "order" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                                          {item.type === "order" ? "Order" : "Quote"}
                                        </span>
                                      </td>
                                      <td className="py-2 pr-4 text-sand-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                                      <td className="py-2 pr-4 text-right tabular-nums text-sand-900">{formatMetricValue("sold", item.amount)}</td>
                                      <td className="py-2">
                                        {item.tags.length === 0 ? (
                                          <span className="text-sand-300 italic">no tags</span>
                                        ) : (
                                          <span className="flex flex-wrap gap-1">
                                            {item.tags.map((tag) => (
                                              <span key={tag} className="px-1.5 py-0.5 rounded bg-sand-200 text-sand-600 text-[10px]">{tag}</span>
                                            ))}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
