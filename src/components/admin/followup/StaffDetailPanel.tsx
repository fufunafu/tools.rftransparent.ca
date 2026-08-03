"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import AnalyticsChart from "./AnalyticsChart";
import { formatCADWhole } from "@/lib/format";

interface MonthData {
  month: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  conversion_rate: number;
  quoted_value: number;
  won_value: number;
}

interface Totals {
  total: number;
  won: number;
  lost: number;
  active: number;
  conversion_rate: number;
  quoted_value: number;
  won_value: number;
}

interface ApiResponse {
  staff: string;
  totals: Totals;
  months: MonthData[];
}

function formatCurrencyShort(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

function StatCard({ label, value, emphasis }: { label: string; value: string; emphasis?: "won" | "lost" | "neutral" }) {
  const color =
    emphasis === "won" ? "text-green-700"
    : emphasis === "lost" ? "text-red-500"
    : "text-sand-900";
  return (
    <div className="bg-sand-50/70 rounded-lg px-3 py-2.5">
      <p className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function QuotedChart({ data }: { data: MonthData[] }) {
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Amount Quoted by Month</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a3a3a3" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "#a3a3a3" }}
              width={45}
              tickFormatter={(v: number) => formatCurrencyShort(v)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
              formatter={(value, name) => {
                const v = Number(value);
                if (name === "won_value") return [formatCADWhole(v), "Won $"];
                if (name === "quoted_value") return [formatCADWhole(v), "Quoted $"];
                return [formatCADWhole(v), String(name)];
              }}
            />
            <Bar dataKey="quoted_value" fill="#cbd5e1" radius={[3, 3, 0, 0]} name="quoted_value" />
            <Bar dataKey="won_value" fill="#22c55e" radius={[3, 3, 0, 0]} name="won_value" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-sand-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-300" /> Total Quoted</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500" /> Won</span>
      </div>
    </div>
  );
}

export default function StaffDetailPanel({
  staff,
  store,
  range,
  onClose,
}: {
  staff: string;
  store: string;
  range: "1y" | "all";
  onClose: () => void;
}) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const queryKey = `${staff}:${store}:${range}`;
  const loading = resolvedKey !== queryKey;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(
      `/api/customer-service/follow-up?view=by_staff_monthly&store=${store}&range=${range}&staff=${encodeURIComponent(staff)}`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((d: ApiResponse | { error: string }) => {
        if ("error" in d) throw new Error(d.error);
        setError("");
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setResolvedKey(queryKey);
      });
    return () => ctrl.abort();
  }, [staff, store, range, queryKey]);

  const displayName = staff === "__unknown__" ? "Unknown" : staff;
  const rangeLabel = range === "1y" ? "Last 12 months" : "All time";

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-sand-200/60 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-lg font-semibold text-sand-900">{displayName}</h3>
            <p className="text-xs text-sand-400">{rangeLabel}</p>
          </div>
          <button onClick={onClose} className="text-sand-400 hover:text-sand-600 p-1" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {loading && <p className="text-sm text-sand-400">Loading…</p>}
          {error && !loading && <p className="text-sm text-red-500">{error}</p>}

          {data && !loading && !error && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Quotes" value={String(data.totals.total)} />
                <StatCard label="Conv. Rate" value={data.totals.total > 0 ? `${data.totals.conversion_rate}%` : "—"} />
                <StatCard label="Won" value={String(data.totals.won)} emphasis="won" />
                <StatCard label="Lost" value={String(data.totals.lost)} emphasis="lost" />
                <StatCard label="Active" value={String(data.totals.active)} />
                <StatCard label="Quoted $" value={formatCADWhole(data.totals.quoted_value)} />
                <StatCard label="Won $" value={formatCADWhole(data.totals.won_value)} emphasis="won" />
              </div>

              {data.months.length === 0 ? (
                <p className="text-sm text-sand-400 py-8 text-center">No quotes in this range.</p>
              ) : (
                <>
                  <AnalyticsChart data={data.months} />
                  <QuotedChart data={data.months} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
