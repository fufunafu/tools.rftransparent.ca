"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Line,
  ComposedChart,
  Area,
} from "recharts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MonthlyTrend {
  month: string;
  draftsCreated: number;
  draftsConverted: number;
  conversionRate: number;
  pipelineValue: number;
  revenue: number;
}

interface PipelineMetrics {
  conversionRate: number;
  avgCycleTimeDays: number;
  pipelineValue: number;
  avgSaleValue: number;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  invoiceSentDrafts: number;
  predictedRevenue: number;
  predictedTimelineDays: number;
  monthlyTrend: MonthlyTrend[];
}

interface RepEntry {
  repTag: string;
  repName: string;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  conversionRate: number;
  totalQuoted: number;
  wonRevenue: number;
  avgCycleTimeDays: number | null;
  avgSaleValue: number;
  pipelineValue: number;
}

interface StoreOption {
  id: string;
  label: string;
}

interface PipelineData {
  metrics: PipelineMetrics;
  leaderboard: RepEntry[];
  stores: StoreOption[];
  period: { from: string; to: string; days: number };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}K`
      : `$${n.toFixed(0)}`;

const fmtFull = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtPct = (n: number) => `${n}%`;

const DAY_OPTIONS = [30, 90, 180, 365, 730] as const;
const DAY_LABELS: Record<number, string> = { 30: "30d", 90: "90d", 180: "6mo", 365: "1yr", 730: "2yr" };

type SortKey = "repName" | "totalDrafts" | "completedDrafts" | "conversionRate" | "pipelineValue" | "wonRevenue" | "avgSaleValue" | "avgCycleTimeDays";

// ─── InfoTip ────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="text-sand-300 hover:text-sand-500 transition-colors focus:outline-none"
        aria-label="More info"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <span className="absolute z-50 left-1/2 -translate-x-1/2 top-6 w-56 bg-sand-900 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg normal-case tracking-normal font-normal">
          {text}
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-sand-900 rotate-45" />
        </span>
      )}
    </span>
  );
}

// ─── Insights ───────────────────────────────────────────────────────────────

function PipelineInsights({ m }: { m: PipelineMetrics }) {
  const insights: { text: string; type: "positive" | "improvement" }[] = [];

  // Positive
  if (m.conversionRate >= 50) {
    insights.push({ text: `Conversion rate of ${m.conversionRate}% is strong — more than half of quotes turn into orders.`, type: "positive" });
  } else if (m.conversionRate >= 30) {
    insights.push({ text: `Conversion rate of ${m.conversionRate}% is solid for this industry.`, type: "positive" });
  }

  if (m.avgCycleTimeDays > 0 && m.avgCycleTimeDays <= 7) {
    insights.push({ text: `Average cycle time of ${m.avgCycleTimeDays} days is fast — deals are closing quickly.`, type: "positive" });
  }

  if (m.pipelineValue > 0) {
    insights.push({ text: `Pipeline value of ${fmtFull(m.pipelineValue)} shows active deal flow with ${m.openDrafts + m.invoiceSentDrafts} quotes in progress.`, type: "positive" });
  }

  if (m.completedDrafts > 0 && m.avgSaleValue > 0) {
    insights.push({ text: `Average sale of ${fmt(m.avgSaleValue)} across ${m.completedDrafts} completed orders.`, type: "positive" });
  }

  if (insights.filter((i) => i.type === "positive").length === 0 && m.totalDrafts > 0) {
    insights.push({ text: `${m.totalDrafts} quotes created in this period — keep building the pipeline.`, type: "positive" });
  }

  // Improvements
  if (m.conversionRate < 30 && m.totalDrafts > 5) {
    insights.push({ text: `Conversion rate of ${m.conversionRate}% is below average. Review lost quotes to identify common objections and improve follow-up.`, type: "improvement" });
  }

  if (m.avgCycleTimeDays > 14) {
    insights.push({ text: `Average cycle time of ${m.avgCycleTimeDays} days is long. Consider following up on stale drafts sooner to close deals faster.`, type: "improvement" });
  }

  if (m.openDrafts > 0 && m.completedDrafts === 0) {
    insights.push({ text: `${m.openDrafts} open quotes but no conversions yet. Prioritize follow-ups on the oldest drafts.`, type: "improvement" });
  }

  if (m.invoiceSentDrafts > 3) {
    insights.push({ text: `${m.invoiceSentDrafts} invoices sent but not yet paid. Follow up to collect payment and close these deals.`, type: "improvement" });
  }

  if (insights.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-sand-200 p-5 space-y-3">
      <p className="text-xs text-sand-400 uppercase tracking-wider">Insights & Recommendations</p>
      <div className="space-y-2.5">
        {insights.map((insight, i) => (
          <div key={i} className="flex gap-2">
            <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
              insight.type === "positive" ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"
            }`}>
              {insight.type === "positive" ? "\u2713" : "!"}
            </span>
            <p className="text-[12px] text-sand-600 leading-relaxed">{insight.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Metric card tooltips ───────────────────────────────────────────────────

const METRIC_TOOLTIPS: Record<string, string> = {
  "Conversion Rate": "Percentage of draft orders (quotes) that were converted to paid orders. Calculated as: completed drafts \u00f7 total drafts \u00d7 100.",
  "Avg Cycle Time": "Average number of days from when a quote was created to when the customer paid and it became an order. Only includes completed drafts. Excludes outliers over 180 days.",
  "Pipeline Value": "Total dollar value of all open and invoiced draft orders that haven't been completed yet. Calculated as: subtotal \u2212 shipping cost \u2212 tariff for each open/invoiced draft.",
  "Avg Sale": "Average revenue per completed draft order. Calculated as: total completed revenue \u00f7 number of completed drafts.",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function PipelineDashboard() {
  const [days, setDays] = useState(90);
  const [store, setStore] = useState("all");
  const [useCustom, setUseCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().split("T")[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("wonRevenue");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ store });
    if (useCustom) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    fetch(`/api/shopify/pipeline?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load pipeline data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days, store, useCustom, customFrom, customTo]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  const sortedLeaderboard = useMemo(() => {
    if (!data) return [];
    return [...data.leaderboard].sort((a, b) => {
      const av = a[sortBy] ?? -1;
      const bv = b[sortBy] ?? -1;
      if (typeof av === "string" && typeof bv === "string")
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, sortBy, sortAsc]);

  const m = data?.metrics;

  const tooltipStyle = {
    contentStyle: { backgroundColor: "#faf9f6", border: "1px solid #e5e0d8", borderRadius: 8, fontSize: 12 },
    labelStyle: { color: "#78736a" },
  };

  const SortIcon = ({ active, asc }: { active: boolean; asc: boolean }) => (
    <span className="ml-1 text-[10px]">{active ? (asc ? "\u25b2" : "\u25bc") : "\u25b4"}</span>
  );

  const stores = data?.stores ?? [];

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold text-sand-900">Sales Pipeline</h2>
            <p className="text-xs text-sand-400 mt-0.5">Draft orders (quotes) to completed sales</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Store selector */}
          {stores.length > 1 && (
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-sand-200 rounded-lg bg-white text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
            >
              <option value="all">All Stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          {/* Time range */}
          <div className="flex gap-1 bg-sand-100 rounded-lg p-0.5">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); setUseCustom(false); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !useCustom && days === d ? "bg-white text-sand-900 shadow-sm" : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
            <button
              onClick={() => setUseCustom(true)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                useCustom ? "bg-white text-sand-900 shadow-sm" : "text-sand-500 hover:text-sand-700"
              }`}
            >
              Custom
            </button>
          </div>
          {useCustom && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 text-xs border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
              />
              <span className="text-xs text-sand-400">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 text-xs border border-sand-200 rounded-md bg-white text-sand-700 focus:outline-none focus:ring-1 focus:ring-sand-400"
              />
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center py-12 text-sand-400 text-sm">Loading pipeline data...</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

      {m && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Main content — 3/4 */}
          <div className="lg:col-span-3 space-y-5">
            {/* Prediction banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
              <p className="text-2xl font-bold text-blue-900">
                {fmtFull(m.predictedRevenue)}{" "}
                <span className="text-base font-normal text-blue-600">
                  predicted revenue{m.avgCycleTimeDays > 0 ? ` in ~${m.avgCycleTimeDays} days` : ""}
                </span>
                <InfoTip text="Estimated revenue from current pipeline. Calculated as: pipeline value \u00d7 conversion rate." />
              </p>
              <p className="text-sm text-blue-500 mt-1">
                {fmtFull(m.pipelineValue)} pipeline &times; {fmtPct(m.conversionRate)} conversion = {fmtFull(m.predictedRevenue)}
                {m.avgCycleTimeDays > 0 && <> &middot; Avg cycle: {m.avgCycleTimeDays} days</>}
              </p>
              {m.pipelineValue === 0 && <p className="text-xs text-blue-400 mt-1">No open draft orders in this period.</p>}
              {m.totalDrafts > 0 && m.completedDrafts === 0 && <p className="text-xs text-blue-400 mt-1">No conversions yet &mdash; prediction is based on zero conversion rate.</p>}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Conversion Rate", value: fmtPct(m.conversionRate), sub: `${m.completedDrafts} of ${m.totalDrafts} drafts` },
                { label: "Avg Cycle Time", value: m.avgCycleTimeDays > 0 ? `${m.avgCycleTimeDays}d` : "N/A", sub: "Draft to order" },
                { label: "Pipeline Value", value: fmt(m.pipelineValue), sub: `${m.openDrafts} open + ${m.invoiceSentDrafts} invoiced` },
                { label: "Avg Sale", value: fmt(m.avgSaleValue), sub: `From ${m.completedDrafts} completed` },
              ].map((card) => (
                <div key={card.label} className="bg-white rounded-xl border border-sand-200 p-5">
                  <div className="flex items-center gap-1">
                    <p className="text-[10px] text-sand-400 uppercase tracking-wider">{card.label}</p>
                    {METRIC_TOOLTIPS[card.label] && <InfoTip text={METRIC_TOOLTIPS[card.label]} />}
                  </div>
                  <p className="text-2xl font-semibold text-sand-900 mt-1">{card.value}</p>
                  <p className="text-xs text-sand-400 mt-0.5">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Monthly trend chart */}
            {m.monthlyTrend.length > 1 && (
              <div className="bg-white rounded-xl border border-sand-200 p-5">
                <h3 className="text-sm font-medium text-sand-700 mb-4">Monthly Trend</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={m.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: "#a39e93" }}
                      tickFormatter={(v: string) => {
                        const [y, mo] = v.split("-");
                        return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(mo, 10) - 1]} '${y.slice(2)}`;
                      }}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v: number) => fmt(v)} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: unknown, name: unknown) => {
                        const v = Number(value);
                        const n = String(name);
                        if (n === "revenue") return [fmtFull(v), "Won Revenue"];
                        if (n === "pipelineValue") return [fmtFull(v), "Pipeline Value"];
                        if (n === "conversionRate") return [`${v}%`, "Conversion Rate"];
                        return [v, n];
                      }}
                    />
                    <Area yAxisId="left" type="monotone" dataKey="revenue" fill="#dbeafe" stroke="#2563eb" fillOpacity={0.3} />
                    <Area yAxisId="left" type="monotone" dataKey="pipelineValue" fill="#dcfce7" stroke="#16a34a" fillOpacity={0.2} />
                    <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Rep leaderboard */}
            {sortedLeaderboard.length > 0 && (
              <div className="bg-white rounded-xl border border-sand-200 p-5">
                <h3 className="text-sm font-medium text-sand-700 mb-4">Rep Leaderboard</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-sand-100">
                        {([
                          ["repName", "Rep"],
                          ["totalDrafts", "Drafts"],
                          ["completedDrafts", "Converted"],
                          ["conversionRate", "Conv%"],
                          ["pipelineValue", "Pipeline $"],
                          ["wonRevenue", "Won $"],
                          ["avgSaleValue", "Avg Sale"],
                          ["avgCycleTimeDays", "Cycle Time"],
                        ] as [SortKey, string][]).map(([key, label]) => (
                          <th
                            key={key}
                            onClick={() => handleSort(key)}
                            className={`pb-2 text-xs font-medium text-sand-500 uppercase cursor-pointer hover:text-sand-700 ${key === "repName" ? "text-left" : "text-right"}`}
                          >
                            {label}
                            <SortIcon active={sortBy === key} asc={sortAsc} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand-50">
                      {sortedLeaderboard.map((r, i) => (
                        <tr key={r.repTag} className={`hover:bg-sand-50 transition-colors ${i === 0 ? "bg-amber-50/40" : ""}`}>
                          <td className="py-2.5 text-sm text-sand-900 font-medium">{r.repName}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{r.totalDrafts}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{r.completedDrafts}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{fmtPct(r.conversionRate)}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{fmt(r.pipelineValue)}</td>
                          <td className="py-2.5 text-sm font-medium text-sand-900 text-right">{fmt(r.wonRevenue)}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{fmt(r.avgSaleValue)}</td>
                          <td className="py-2.5 text-sm text-sand-500 text-right">
                            {r.avgCycleTimeDays !== null ? `${r.avgCycleTimeDays}d` : "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Status breakdown bar */}
            {m.totalDrafts > 0 && (
              <div className="bg-white rounded-xl border border-sand-200 p-5">
                <h3 className="text-sm font-medium text-sand-700 mb-4">Draft Status Breakdown</h3>
                <ResponsiveContainer width="100%" height={60}>
                  <BarChart
                    layout="vertical"
                    data={[{ open: m.openDrafts, invoiceSent: m.invoiceSentDrafts, completed: m.completedDrafts }]}
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey={() => ""} hide />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: unknown, name: unknown) => {
                        const n = String(name);
                        const label = n === "open" ? "Open" : n === "invoiceSent" ? "Invoice Sent" : "Completed";
                        return [String(value), label];
                      }}
                    />
                    <Bar dataKey="open" stackId="a" fill="#f59e0b" radius={[4, 0, 0, 4]} />
                    <Bar dataKey="invoiceSent" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="completed" stackId="a" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2 text-xs text-sand-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Open ({m.openDrafts})</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Invoice Sent ({m.invoiceSentDrafts})</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-600" /> Completed ({m.completedDrafts})</span>
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar — insights */}
          <div className="lg:col-span-1 space-y-5">
            <PipelineInsights m={m} />
          </div>
        </div>
      )}
    </div>
  );
}
