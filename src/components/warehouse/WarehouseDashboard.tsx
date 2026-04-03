"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { EmployeeTab } from "@/components/admin/KPIDashboard";

type Period = "daily" | "weekly" | "monthly";
type Tab = "reports" | "fulfillment";

interface Report {
  id: string;
  employee_id: string;
  report_date: string;
  boxes_built: number;
  orders_packed: number;
  boxes_closed: number;
  shipments_booked: number;
  notes: string | null;
  employees: { id: string; name: string };
}

interface EmployeeSummary {
  id: string;
  name: string;
  boxes_built: number;
  orders_packed: number;
  boxes_closed: number;
  shipments_booked: number;
  total: number;
}

interface DayData {
  date: string;
  boxes_built: number;
  orders_packed: number;
  boxes_closed: number;
  shipments_booked: number;
}

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const STEP_COLORS = {
  boxes_built: "#6366f1",
  orders_packed: "#f59e0b",
  boxes_closed: "#10b981",
  shipments_booked: "#3b82f6",
};

const STEP_LABELS: Record<string, string> = {
  boxes_built: "Boxes Built",
  orders_packed: "Orders Packed",
  boxes_closed: "Boxes Closed",
  shipments_booked: "Shipments Booked",
};

function getDateRange(period: Period, dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  let from: Date;
  let to: Date;

  if (period === "daily") {
    from = d;
    to = d;
  } else if (period === "weekly") {
    const day = d.getDay();
    from = new Date(d);
    from.setDate(d.getDate() - ((day + 6) % 7)); // Monday
    to = new Date(from);
    to.setDate(from.getDate() + 6); // Sunday
  } else {
    from = new Date(d.getFullYear(), d.getMonth(), 1);
    to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function WarehouseDashboard() {
  const [tab, setTab] = useState<Tab>("reports");
  const [period, setPeriod] = useState<Period>("daily");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<string>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const range = getDateRange(period, date);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/warehouse/reports?from=${range.from}&to=${range.to}`
      );
      if (!res.ok) throw new Error("Failed to load reports");
      const data: Report[] = await res.json();
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    if (tab === "reports") loadReports();
  }, [loadReports, tab]);

  // Aggregate totals
  const totals = reports.reduce(
    (acc, r) => ({
      boxes_built: acc.boxes_built + r.boxes_built,
      orders_packed: acc.orders_packed + r.orders_packed,
      boxes_closed: acc.boxes_closed + r.boxes_closed,
      shipments_booked: acc.shipments_booked + r.shipments_booked,
    }),
    { boxes_built: 0, orders_packed: 0, boxes_closed: 0, shipments_booked: 0 }
  );

  // Per-employee breakdown
  const employeeMap = new Map<string, EmployeeSummary>();
  for (const r of reports) {
    const existing = employeeMap.get(r.employee_id) || {
      id: r.employee_id,
      name: r.employees?.name || "Unknown",
      boxes_built: 0,
      orders_packed: 0,
      boxes_closed: 0,
      shipments_booked: 0,
      total: 0,
    };
    existing.boxes_built += r.boxes_built;
    existing.orders_packed += r.orders_packed;
    existing.boxes_closed += r.boxes_closed;
    existing.shipments_booked += r.shipments_booked;
    existing.total +=
      r.boxes_built + r.orders_packed + r.boxes_closed + r.shipments_booked;
    employeeMap.set(r.employee_id, existing);
  }

  const employeeSummaries = [...employeeMap.values()].sort((a, b) => {
    const aVal = a[sortBy as keyof EmployeeSummary] as number ?? 0;
    const bVal = b[sortBy as keyof EmployeeSummary] as number ?? 0;
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  // Daily chart data
  const dayMap = new Map<string, DayData>();
  for (const r of reports) {
    const existing = dayMap.get(r.report_date) || {
      date: r.report_date,
      boxes_built: 0,
      orders_packed: 0,
      boxes_closed: 0,
      shipments_booked: 0,
    };
    existing.boxes_built += r.boxes_built;
    existing.orders_packed += r.orders_packed;
    existing.boxes_closed += r.boxes_closed;
    existing.shipments_booked += r.shipments_booked;
    dayMap.set(r.report_date, existing);
  }
  const chartData = [...dayMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const summaryCards = [
    { key: "boxes_built", label: "Boxes Built", value: totals.boxes_built },
    { key: "orders_packed", label: "Orders Packed", value: totals.orders_packed },
    { key: "boxes_closed", label: "Boxes Closed", value: totals.boxes_closed },
    { key: "shipments_booked", label: "Shipments Booked", value: totals.shipments_booked },
  ];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-sand-200">
        {(
          [
            { value: "reports", label: "Daily Reports" },
            { value: "fulfillment", label: "Fulfillment KPIs" },
          ] as { value: Tab; label: string }[]
        ).map((t) => (
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

      {tab === "fulfillment" && <EmployeeTab department="warehouse" />}

      {tab === "reports" && (
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

            <button
              onClick={loadReports}
              disabled={loading}
              className="ml-auto px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <p className="text-xs text-sand-400">
            Showing: {range.from} &rarr; {range.to}
          </p>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summaryCards.map((card) => (
              <div
                key={card.key}
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
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-4">
              <h3 className="text-sm font-medium text-sand-700 mb-4">
                Daily Throughput
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    tick={{ fontSize: 12 }}
                    stroke="#a8a29e"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    stroke="#a8a29e"
                    allowDecimals={false}
                  />
                  <Tooltip
                    labelFormatter={(label) => formatDate(String(label))}
                    contentStyle={{
                      borderRadius: "0.5rem",
                      border: "1px solid #e7e5e4",
                      fontSize: "0.875rem",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "0.75rem" }}
                  />
                  <Bar
                    dataKey="boxes_built"
                    name="Boxes Built"
                    stackId="a"
                    fill={STEP_COLORS.boxes_built}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="orders_packed"
                    name="Orders Packed"
                    stackId="a"
                    fill={STEP_COLORS.orders_packed}
                  />
                  <Bar
                    dataKey="boxes_closed"
                    name="Boxes Closed"
                    stackId="a"
                    fill={STEP_COLORS.boxes_closed}
                  />
                  <Bar
                    dataKey="shipments_booked"
                    name="Shipments Booked"
                    stackId="a"
                    fill={STEP_COLORS.shipments_booked}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Employee breakdown table */}
          <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400">
                      Employee
                    </th>
                    {Object.entries(STEP_LABELS).map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400 cursor-pointer hover:text-sand-700 select-none"
                      >
                        {label}
                        {sortBy === key && (
                          <span className="ml-1">
                            {sortDir === "desc" ? "\u2193" : "\u2191"}
                          </span>
                        )}
                      </th>
                    ))}
                    <th
                      onClick={() => handleSort("total")}
                      className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-sand-400 cursor-pointer hover:text-sand-700 select-none"
                    >
                      Total
                      {sortBy === "total" && (
                        <span className="ml-1">
                          {sortDir === "desc" ? "\u2193" : "\u2191"}
                        </span>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employeeSummaries.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sand-400"
                      >
                        No reports for this period.
                      </td>
                    </tr>
                  )}
                  {employeeSummaries.map((emp) => (
                    <tr
                      key={emp.id}
                      className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-sand-900">
                        {emp.name}
                      </td>
                      <td className="px-4 py-3 text-right text-sand-900">
                        {emp.boxes_built}
                      </td>
                      <td className="px-4 py-3 text-right text-sand-900">
                        {emp.orders_packed}
                      </td>
                      <td className="px-4 py-3 text-right text-sand-900">
                        {emp.boxes_closed}
                      </td>
                      <td className="px-4 py-3 text-right text-sand-900">
                        {emp.shipments_booked}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-900">
                        {emp.total}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  {employeeSummaries.length > 0 && (
                    <tr className="bg-sand-50/80 border-t border-sand-200">
                      <td className="px-4 py-3 font-semibold text-sand-700">
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-700">
                        {totals.boxes_built}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-700">
                        {totals.orders_packed}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-700">
                        {totals.boxes_closed}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-700">
                        {totals.shipments_booked}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sand-700">
                        {totals.boxes_built + totals.orders_packed + totals.boxes_closed + totals.shipments_booked}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {loading && reports.length === 0 && (
            <div className="text-center py-12 text-sand-400">
              Loading reports...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
