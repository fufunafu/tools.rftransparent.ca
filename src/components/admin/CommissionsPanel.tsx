"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCAD } from "@/lib/format";
import type { MonthlyCommission } from "@/lib/commission";

interface RepCommission {
  employeeId: string;
  name: string;
  rate: number;
  months: MonthlyCommission[];
  totalNet: number;
  totalCommission: number;
}

interface CommissionsResponse {
  year: number;
  reps: RepCommission[];
  ambiguousOrders: { name: string; tags: string[] }[];
  storeErrors: Record<string, string>;
  cachedAt: string | null;
  error?: string;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function CommissionsPanel() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<CommissionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedRep, setExpandedRep] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/kpi/commissions?year=${year}${refresh ? "&refresh=1" : ""}`);
        const json: CommissionsResponse = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load commissions");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [year]
  );

  useEffect(() => {
    load();
  }, [load]);

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];
  const loadedYear = data?.year ?? year;
  const visibleReps = data?.reps.filter((r) => r.rate > 0) ?? [];
  const unconfigured = data?.reps.filter((r) => r.rate === 0) ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-sand-900">Commissions</h2>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 bg-white"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          {data?.cachedAt && (
            <span className="text-xs text-sand-400">
              Updated {new Date(data.cachedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 text-sm text-sand-600 border border-sand-200 rounded-lg hover:bg-sand-50 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <p className="text-xs text-sand-400 max-w-3xl">
        Commission is earned on money actually collected: completed payments minus refunds,
        excluding taxes and shipping. Refunds subtract in the month they were issued — a
        negative month means refunds outweighed new sales. Amounts come straight from
        Shopify payment records.
      </p>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && Object.entries(data.storeErrors).length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          Some stores could not be read — totals may be incomplete:{" "}
          {Object.entries(data.storeErrors)
            .map(([store, message]) => `${store}: ${message}`)
            .join(" · ")}
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-10 text-sand-400">Loading commissions...</div>
      )}

      {data && visibleReps.length === 0 && !loading && (
        <div className="rounded-xl border border-sand-200/60 bg-white px-4 py-8 text-center text-sm text-sand-400">
          No sales reps have a commission rate configured yet. Set one on the employee
          profile (Employees &rarr; edit &rarr; Commission Rate).
        </div>
      )}

      {visibleReps.map((rep) => {
        const expanded = expandedRep === rep.employeeId;
        const monthsWithActivity = rep.months.filter((m) => m.collected !== 0 || m.commission !== 0);
        return (
          <div key={rep.employeeId} className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
            <button
              onClick={() => setExpandedRep(expanded ? null : rep.employeeId)}
              className="w-full flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-left hover:bg-sand-50/50 transition-colors"
            >
              <span className="font-medium text-sand-900">{rep.name}</span>
              <span className="text-xs text-sand-400">{(rep.rate * 100).toFixed(1).replace(/\.0$/, "")}% rate</span>
              <span className="ml-auto text-sm text-sand-500">
                Net {formatCAD(rep.totalNet)}
              </span>
              <span className="text-sm font-semibold text-sand-900 tabular-nums">
                {formatCAD(rep.totalCommission)}
              </span>
              <span className="text-sand-400 text-xs">{expanded ? "▲" : "▼"}</span>
            </button>

            {expanded && (
              <div className="border-t border-sand-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-100">
                      <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sand-400">Month</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sand-400">Orders</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sand-400">Collected</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sand-400">Net revenue</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sand-400">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthsWithActivity.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sand-400">
                          No activity in {loadedYear}.
                        </td>
                      </tr>
                    )}
                    {monthsWithActivity.map((m) => {
                      const negative = m.commission < 0;
                      const monthIndex = Number(m.month.slice(5)) - 1;
                      return (
                        <tr key={m.month} className="border-b border-sand-50 last:border-0">
                          <td className="px-4 py-2 text-sand-900">
                            {MONTH_LABELS[monthIndex]} {loadedYear}
                            {m.refundCount > 0 && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-sand-400">
                                {m.refundCount} refund{m.refundCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-sand-500">{m.orderCount}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-sand-900">{formatCAD(m.collected)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-sand-900">{formatCAD(m.net)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-medium ${negative ? "text-red-600" : "text-sand-900"}`}>
                            {formatCAD(m.commission)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-sand-50/60">
                      <td className="px-4 py-2 font-semibold text-sand-900">Total {loadedYear}</td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-sand-900">{formatCAD(rep.totalNet)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-sand-900">{formatCAD(rep.totalCommission)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {data && data.ambiguousOrders.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">
            {data.ambiguousOrders.length} order{data.ambiguousOrders.length > 1 ? "s" : ""} tagged
            for more than one rep — excluded until resolved
          </summary>
          <div className="mt-2 space-y-1">
            {data.ambiguousOrders.map((o) => (
              <p key={o.name} className="font-mono">
                {o.name} <span className="font-sans text-amber-700">({o.tags.join(", ")})</span>
              </p>
            ))}
          </div>
          <p className="mt-2">
            Fix the tags in Shopify (keep one rep tag per order) and refresh.
          </p>
        </details>
      )}

      {unconfigured.length > 0 && visibleReps.length > 0 && (
        <p className="text-xs text-sand-400">
          No commission rate set for: {unconfigured.map((r) => r.name).join(", ")} — set one on
          the employee profile to include them.
        </p>
      )}
    </section>
  );
}
