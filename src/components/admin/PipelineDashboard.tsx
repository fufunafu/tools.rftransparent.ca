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
  totalQuotedValue: number;
  wonRevenue: number;
  conversionRate: number;
  valueWinRate: number;
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

interface AgeBucket {
  label: string;
  drafts: number;
  value: number;
  conversionRate: number;
  predictedValue: number;
}

interface MonthlyForecast {
  month: string;
  monthLabel: string;
  forecast: number;
  prevMonthRevenue: number;
  momRate: number;
  momRateCapped: boolean;
  fromPipeline: number;
  isFallback: boolean;
}

interface SeasonalMonth {
  month: string;
  monthLabel: string;
  revenue: number;
  momGrowth: number | null;
}

interface PipelinePrediction {
  totalPipelineValue: number;
  totalPredictedRevenue: number;
  avgMonthlyRevenue: number;
  avgCycleTimeDays: number;
  startingMonth: string;
  startingRevenue: number;
  monthlyForecasts: MonthlyForecast[];
  annualForecast: number;
  fallbackMomRates: Record<number, number>;
  buckets: AgeBucket[];
  seasonalPattern: SeasonalMonth[];
}

interface ChannelMonthlyTrend {
  month: string;
  draftOrders: number;
  draftRevenue: number;
  directOrders: number;
  directRevenue: number;
  draftRevenueShare: number;
}

interface RepChannelEntry {
  repTag: string;
  repName: string;
  orders: number;
  revenue: number;
  aov: number;
}

interface OrderChannelMetrics {
  totalOrders: number;
  totalRevenue: number;
  draftOrders: number;
  draftRevenue: number;
  draftAOV: number;
  directOrders: number;
  directRevenue: number;
  directAOV: number;
  draftRevenueShare: number;
  employeeBreakdown: RepChannelEntry[];
  monthlyTrend: ChannelMonthlyTrend[];
}

interface PipelineData {
  metrics: PipelineMetrics;
  prediction: PipelinePrediction;
  channelMetrics: OrderChannelMetrics;
  leaderboard: RepEntry[];
  stores: StoreOption[];
  period: { from: string; to: string; days: number };
  cachedAt?: string;
}

// ─── Formatters ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(2)}K`
      : `$${n.toFixed(2)}`;

const fmtFull = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    insights.push({ text: `Pipeline value of ${fmtFull(m.pipelineValue)} from ${m.invoiceSentDrafts} invoiced quotes awaiting payment.`, type: "positive" });
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
  "Pipeline Value": "Total dollar value of invoiced draft orders that haven't been completed yet. Only includes drafts where an invoice has been sent to the customer.",
  "Avg Sale": "Average revenue per completed draft order. Calculated as: total completed revenue \u00f7 number of completed drafts.",
};

// ─── Fallback Rates Editor ──────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TRANSITION_LABELS = [
  "Dec→Jan", "Jan→Feb", "Feb→Mar", "Mar→Apr", "Apr→May", "May→Jun",
  "Jun→Jul", "Jul→Aug", "Aug→Sep", "Sep→Oct", "Oct→Nov", "Nov→Dec",
];

function FallbackRatesEditor({ rates, onSaved }: { rates: Record<number, number>; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    const d: Record<number, string> = {};
    for (let i = 0; i < 12; i++) {
      d[i] = String(Math.round((rates[i] ?? 0) * 100));
    }
    setDraft(d);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const ratesObj: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      ratesObj[i] = (parseFloat(draft[i]) || 0) / 100;
    }
    try {
      const res = await fetch("/api/settings/forecast-rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: ratesObj }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      onSaved();
    } catch {
      alert("Failed to save rates");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-blue-100 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-blue-800 font-medium">Seasonal fallback rates</p>
        {!editing ? (
          <button onClick={startEdit} className="text-xs text-blue-500 hover:text-blue-700 underline">Edit</button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded-md disabled:opacity-50">
              {saving ? "Saving..." : "Save & Recalculate"}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-blue-500">Used when Shopify data is missing for a month transition (pre-July 2025).</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-blue-600 whitespace-nowrap">{TRANSITION_LABELS[i]}</span>
            {editing ? (
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={draft[i] ?? "0"}
                  onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))}
                  className="w-14 px-1.5 py-0.5 text-right text-xs border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-blue-400">%</span>
              </div>
            ) : (
              <span className={`font-medium ${(rates[i] ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {(rates[i] ?? 0) >= 0 ? "+" : ""}{Math.round((rates[i] ?? 0) * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

// Session-level cache: survives tab navigation, clears on refresh
const pipelineCache = new Map<string, { data: PipelineData; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  const [refreshing, setRefreshing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("wonRevenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [loadStep, setLoadStep] = useState("");
  const [showCalc, setShowCalc] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams({ store });
    if (useCustom) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    const cacheKey = params.toString();

    // Check cache — show stale data immediately, refresh in background
    const cached = pipelineCache.get(cacheKey);
    if (cached) {
      setData(cached.data);
      setLoading(false);
      if (Date.now() - cached.ts < CACHE_TTL_MS) return; // still fresh
      setRefreshing(true); // stale — refresh in background
    } else {
      setLoading(true);
      setLoadStep("Connecting to Shopify...");
    }

    setError("");

    // Simulate progress steps for slow loads
    const stepTimer = !cached
      ? setTimeout(() => { if (!cancelled) setLoadStep("Fetching draft orders & computing predictions..."); }, 3000)
      : undefined;

    fetch(`/api/shopify/pipeline?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
        pipelineCache.set(cacheKey, { data: json, ts: Date.now() });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load pipeline data");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          setLoadStep("");
        }
      });

    return () => { cancelled = true; clearTimeout(stepTimer); };
  }, [days, store, useCustom, customFrom, customTo]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const params = new URLSearchParams({ store, refresh: "true" });
      if (useCustom) { params.set("from", customFrom); params.set("to", customTo); }
      else params.set("days", String(days));

      const res = await fetch(`/api/shopify/pipeline?${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      pipelineCache.set(params.toString(), { data: json, ts: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalculation failed");
    } finally {
      setRecalculating(false);
    }
  };

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
  const pred = data?.prediction;
  const ch = data?.channelMetrics;

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
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-sand-400">
                Draft orders (quotes) to completed sales
                {refreshing && <span className="ml-2 text-blue-400 animate-pulse">Refreshing...</span>}
              </p>
              {data?.cachedAt && (
                <span className="text-[10px] text-sand-300">
                  Computed {(() => {
                    const mins = Math.floor((Date.now() - new Date(data.cachedAt).getTime()) / 60000);
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins}m ago`;
                    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
                  })()}
                </span>
              )}
              <button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="text-[10px] text-sand-400 hover:text-sand-600 disabled:opacity-50 underline"
                title="Force recalculate from Shopify (ignores cache)"
              >
                {recalculating ? "Recalculating..." : "Recalculate"}
              </button>
            </div>
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

      {loading && (
        <div className="text-center py-12 space-y-3">
          <div className="inline-block w-48 h-1.5 bg-sand-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: loadStep.includes("predictions") ? "70%" : "30%" }} />
          </div>
          <p className="text-sand-400 text-sm">{loadStep || "Loading..."}</p>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

      {m && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Main content — 3/4 */}
          <div className="lg:col-span-3 space-y-5">
            {/* ── 1. Period summary: what did we quote and what converted? ── */}
            <div className="bg-white rounded-xl border border-sand-200 p-5">
              <div className="grid grid-cols-3 divide-x divide-sand-100">
                <div className="pr-5">
                  <p className="text-[10px] text-sand-400 uppercase tracking-wider">Quoted</p>
                  <p className="text-2xl font-bold text-sand-900 mt-1">{fmt(m.totalQuotedValue)}</p>
                  <p className="text-xs text-sand-400 mt-0.5">{m.totalDrafts} drafts created</p>
                </div>
                <div className="px-5">
                  <p className="text-[10px] text-sand-400 uppercase tracking-wider">Converted</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">{fmt(m.wonRevenue)}</p>
                  <p className="text-xs text-sand-400 mt-0.5">{m.completedDrafts} orders &middot; {fmtPct(m.conversionRate)} rate</p>
                </div>
                <div className="pl-5">
                  <p className="text-[10px] text-sand-400 uppercase tracking-wider">Pending</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{fmt(m.pipelineValue)}</p>
                  <p className="text-xs text-sand-400 mt-0.5">{m.invoiceSentDrafts} invoiced &middot; {m.openDrafts} open</p>
                </div>
              </div>
            </div>

            {/* ── 1b. Revenue split: draft orders vs direct web ── */}
            {ch && ch.totalOrders > 0 && (
              <div className="bg-white rounded-xl border border-sand-200 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-sand-400 uppercase tracking-wider">
                    Revenue by Channel
                  </p>
                  <InfoTip text="Compares revenue from draft orders (quotes your team sends) vs direct web purchases (customers buying online without a quote). Based on actual paid orders, not drafts." />
                </div>

                <div className="grid grid-cols-3 divide-x divide-sand-100">
                  <div className="pr-5">
                    <p className="text-[10px] text-sand-400 uppercase tracking-wider">Total Revenue</p>
                    <p className="text-2xl font-bold text-sand-900 mt-1">{fmt(ch.totalRevenue)}</p>
                    <p className="text-xs text-sand-400 mt-0.5">{ch.totalOrders} orders</p>
                  </div>
                  <div className="px-5">
                    <p className="text-[10px] text-purple-400 uppercase tracking-wider">From Quotes</p>
                    <p className="text-2xl font-bold text-purple-600 mt-1">{fmt(ch.draftRevenue)}</p>
                    <p className="text-xs text-sand-400 mt-0.5">
                      {ch.draftOrders} orders &middot; {fmt(ch.draftAOV)} avg
                    </p>
                  </div>
                  <div className="pl-5">
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Direct Web</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{fmt(ch.directRevenue)}</p>
                    <p className="text-xs text-sand-400 mt-0.5">
                      {ch.directOrders} orders &middot; {fmt(ch.directAOV)} avg
                    </p>
                  </div>
                </div>

                {/* Revenue split bar */}
                <div>
                  <div className="flex h-3 rounded-full overflow-hidden">
                    <div
                      className="bg-purple-500 transition-all"
                      style={{ width: `${ch.draftRevenueShare}%` }}
                      title={`Quotes: ${fmtPct(ch.draftRevenueShare)}`}
                    />
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{ width: `${100 - ch.draftRevenueShare}%` }}
                      title={`Direct: ${fmtPct(100 - ch.draftRevenueShare)}`}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5 text-xs text-sand-500">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-purple-500" />
                      Quotes {fmtPct(ch.draftRevenueShare)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      Direct {fmtPct(Math.round((100 - ch.draftRevenueShare) * 10) / 10)}
                      <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                    </span>
                  </div>
                </div>

                {/* Employee attribution for quote-originated orders (hidden if only unassigned) */}
                {ch.employeeBreakdown.length > 0 && ch.employeeBreakdown.some((e) => e.repTag !== "(unassigned)") && (
                  <div>
                    <p className="text-[10px] text-sand-400 uppercase tracking-wider mb-2">Quote Revenue by Employee</p>
                    <div className="space-y-1.5">
                      {ch.employeeBreakdown.map((emp) => {
                        const pct = ch.draftRevenue > 0 ? (emp.revenue / ch.draftRevenue) * 100 : 0;
                        return (
                          <div key={emp.repTag} className="flex items-center gap-3">
                            <p className="text-sm text-sand-700 font-medium w-36 truncate">{emp.repName}</p>
                            <div className="flex-1 h-5 bg-sand-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-purple-400 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <p className="text-sm text-sand-700 font-medium w-20 text-right">{fmt(emp.revenue)}</p>
                            <p className="text-xs text-sand-400 w-16 text-right">{emp.orders} orders</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monthly channel trend chart with quote share % line */}
                {ch.monthlyTrend.length > 1 && (
                  <div className="pt-2">
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={ch.monthlyTrend}>
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
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} />
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: unknown, name: unknown) => {
                            const v = Number(value);
                            const n = String(name);
                            if (n === "draftRevenue") return [fmtFull(v), "Quote Revenue"];
                            if (n === "directRevenue") return [fmtFull(v), "Direct Web Revenue"];
                            if (n === "draftRevenueShare") return [`${v}%`, "Quote Share"];
                            return [v, n];
                          }}
                        />
                        <Bar yAxisId="left" dataKey="draftRevenue" stackId="rev" fill="#a855f7" radius={[0, 0, 0, 0]} />
                        <Bar yAxisId="left" dataKey="directRevenue" stackId="rev" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="draftRevenueShare" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: "#7c3aed" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-5 mt-1 text-xs text-sand-500">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500" /> Quotes</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Direct Web</span>
                      <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-purple-600 rounded" /> Quote Share %</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 2. Revenue forecast ── */}
            {pred && (
              <div className="space-y-4">
                <p className="text-xs text-sand-400 uppercase tracking-wider">
                  Revenue Forecast
                  <InfoTip text={`Compounds forward from ${pred.startingMonth} (${fmt(pred.startingRevenue)}) using last year's month-over-month growth rates. Each month = previous month × (1 + last year's MoM%). MoM rates capped at ±200%. Falls back to 0% growth when no prior year data.`} />
                </p>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                    <p className="text-[10px] text-blue-400 uppercase tracking-wider">12-Month Forecast</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">{fmt(pred.annualForecast)}</p>
                    <p className="text-xs text-blue-500 mt-0.5">Next 12 months projected</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                    <p className="text-[10px] text-blue-400 uppercase tracking-wider">Starting From</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">{fmt(pred.startingRevenue)}</p>
                    <p className="text-xs text-blue-500 mt-0.5">{pred.startingMonth} actual revenue</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                    <p className="text-[10px] text-blue-400 uppercase tracking-wider">Pipeline Value</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">{fmt(pred.totalPipelineValue)}</p>
                    <p className="text-xs text-blue-500 mt-0.5">{fmt(pred.totalPredictedRevenue)} weighted by win rate</p>
                  </div>
                </div>

                {/* Show calculation toggle */}
                <button
                  onClick={() => setShowCalc((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 transition-transform ${showCalc ? "rotate-90" : ""}`}>
                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                  </svg>
                  {showCalc ? "Hide calculation" : "Show calculation"}
                </button>

                {/* Calculation details */}
                {showCalc && (
                  <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4 text-sm">
                    <p className="text-xs text-blue-400 uppercase tracking-wider font-medium">How this forecast is calculated</p>

                    {/* Method explanation */}
                    <div className="space-y-2">
                      <p className="text-blue-800 font-medium">Method: Seasonal MoM Compounding</p>
                      <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 space-y-1">
                        <p>1. Start from last completed month: <span className="font-bold">{pred.startingMonth} = {fmt(pred.startingRevenue)}</span></p>
                        <p>2. For each future month, apply last year&apos;s MoM growth rate for that same month transition</p>
                        <p>3. MoM rates are capped at &plusmn;200% to prevent extreme outliers from skewing the forecast</p>
                        <p>4. If no prior year data exists for a transition, 0% growth is assumed</p>
                      </div>
                    </div>

                    {/* Per-month breakdown */}
                    <div className="space-y-2">
                      <p className="text-blue-800 font-medium">Month-by-month calculation</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-blue-100">
                              <th className="pb-1 text-left text-blue-400 font-medium">Month</th>
                              <th className="pb-1 text-right text-blue-400 font-medium">Prev Month</th>
                              <th className="pb-1 text-center text-blue-400 font-medium">&times;</th>
                              <th className="pb-1 text-right text-blue-400 font-medium">MoM Rate</th>
                              <th className="pb-1 text-center text-blue-400 font-medium">=</th>
                              <th className="pb-1 text-right text-blue-400 font-medium">Forecast</th>
                              <th className="pb-1 text-right text-blue-400 font-medium">Pipeline</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-blue-50">
                            {pred.monthlyForecasts.map((f) => (
                              <tr key={f.month}>
                                <td className="py-1 text-blue-700">
                                  {f.monthLabel}
                                  {f.isFallback && <span className="ml-1 text-[10px] text-amber-500" title="No prior year data — 0% growth assumed">*</span>}
                                  {f.momRateCapped && <span className="ml-1 text-[10px] text-red-400" title="MoM rate was capped at ±200%">!</span>}
                                </td>
                                <td className="py-1 text-right text-slate-500">{fmt(f.prevMonthRevenue)}</td>
                                <td className="py-1 text-center text-blue-300">&times;</td>
                                <td className={`py-1 text-right font-medium ${f.momRate >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {f.momRate >= 0 ? "+" : ""}{Math.round(f.momRate * 100)}%
                                </td>
                                <td className="py-1 text-center text-blue-300">=</td>
                                <td className="py-1 text-right text-blue-800 font-medium">{fmt(f.forecast)}</td>
                                <td className="py-1 text-right text-violet-600">{f.fromPipeline > 0 ? fmt(f.fromPipeline) : "—"}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-blue-200">
                              <td colSpan={5} className="py-1.5 text-blue-800 font-bold">12-Month Total</td>
                              <td className="py-1.5 text-right text-blue-900 font-bold">{fmt(pred.annualForecast)}</td>
                              <td className="py-1.5 text-right text-violet-700 font-medium">
                                {fmt(pred.monthlyForecasts.reduce((s, f) => s + f.fromPipeline, 0))}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-4 text-[10px] text-blue-400">
                        {pred.monthlyForecasts.some((f) => f.isFallback) && (
                          <span>* No prior year data — 0% growth assumed</span>
                        )}
                        {pred.monthlyForecasts.some((f) => f.momRateCapped) && (
                          <span className="text-red-400">! MoM rate was capped at &plusmn;200%</span>
                        )}
                      </div>
                    </div>

                    {/* Editable fallback rates */}
                    <FallbackRatesEditor
                      rates={pred.fallbackMomRates}
                      onSaved={handleRecalculate}
                    />
                  </div>
                )}

                {/* Month-by-month forecast chart */}
                {pred.monthlyForecasts.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-700">
                        Monthly Forecast
                        <span className="font-normal text-blue-500 ml-1">(next 12 months)</span>
                      </p>
                      <InfoTip text="Blue bars = projected revenue. Purple bars = pipeline (quoted/invoiced) portion already visible. Dashed outline = same month last year for comparison." />
                    </div>
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={pred.monthlyForecasts}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: "#60a5fa" }} interval={0} angle={-45} textAnchor="end" height={50} />
                        <YAxis tick={{ fontSize: 11, fill: "#60a5fa" }} tickFormatter={(v: number) => fmt(v)} />
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: unknown, name: unknown) => {
                            const v = Number(value);
                            const n = String(name);
                            if (n === "forecast") return [fmtFull(v), "Forecast"];
                            if (n === "fromPipeline") return [fmtFull(v), "From Pipeline"];
                            return [v, n];
                          }}
                        />
                        <Bar dataKey="forecast" fill="#2563eb" radius={[4, 4, 0, 0]} name="forecast" />
                        <Bar dataKey="fromPipeline" fill="#7c3aed" radius={[4, 4, 0, 0]} name="fromPipeline" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-5 text-xs text-blue-500">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" /> Forecast</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-600" /> From Pipeline</span>
                    </div>
                  </div>
                )}

                {/* Historical seasonal pattern */}
                {pred.seasonalPattern.length > 2 && (() => {
                  const activeMonths = pred.seasonalPattern.filter((m) => m.revenue > 0);
                  const chartData = activeMonths.map((m, i) => ({
                    ...m,
                    momGrowthClamped: i === 0 ? null : m.momGrowth !== null ? Math.max(-100, Math.min(100, m.momGrowth)) : null,
                  }));
                  return chartData.length > 2 ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-700">
                        Seasonal Pattern
                        <span className="font-normal text-blue-500 ml-1">(month-over-month growth)</span>
                      </p>
                      <InfoTip text="Historical monthly revenue from all orders with month-over-month growth %. Positive = seasonal ramp-up, negative = seasonal slowdown. Growth % clamped to ±100% for readability." />
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                        <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: "#60a5fa" }} interval={0} angle={-45} textAnchor="end" height={50} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#60a5fa" }} tickFormatter={(v: number) => fmt(v)} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#60a5fa" }} tickFormatter={(v: number) => `${v}%`} domain={[-100, 100]} />
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: unknown, name: unknown) => {
                            const v = Number(value);
                            const n = String(name);
                            if (n === "revenue") return [fmtFull(v), "Revenue"];
                            if (n === "momGrowthClamped") return [v !== null ? `${v > 0 ? "+" : ""}${v}%` : "N/A", "MoM Change"];
                            return [v, n];
                          }}
                        />
                        <Bar yAxisId="left" dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="momGrowthClamped" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-5 text-xs text-blue-500">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" /> Monthly Revenue</span>
                      <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-amber-500 rounded" /> MoM Growth %</span>
                    </div>
                  </div>
                  ) : null;
                })()}

                {/* Pipeline age breakdown */}
                {pred.buckets.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-700">
                        {fmtFull(pred.totalPipelineValue)} in pipeline
                        <span className="font-normal text-blue-500"> across {pred.buckets.reduce((s, b) => s + b.drafts, 0)} invoiced drafts</span>
                      </p>
                      {pred.avgCycleTimeDays > 0 && (
                        <p className="text-xs text-blue-500">Avg cycle: {pred.avgCycleTimeDays} days</p>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-blue-200">
                            <th className="pb-1.5 text-left font-medium text-blue-400 uppercase tracking-wider">Invoice Age</th>
                            <th className="pb-1.5 text-right font-medium text-blue-400 uppercase tracking-wider">Drafts</th>
                            <th className="pb-1.5 text-right font-medium text-blue-400 uppercase tracking-wider">Value</th>
                            <th className="pb-1.5 text-right font-medium text-blue-400 uppercase tracking-wider">Win Rate</th>
                            <th className="pb-1.5 text-right font-medium text-blue-400 uppercase tracking-wider">Predicted</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-100">
                          {pred.buckets.map((b) => (
                            <tr key={b.label}>
                              <td className="py-1.5 text-blue-700 font-medium">{b.label}</td>
                              <td className="py-1.5 text-blue-600 text-right">{b.drafts}</td>
                              <td className="py-1.5 text-blue-600 text-right">{fmt(b.value)}</td>
                              <td className="py-1.5 text-blue-600 text-right">{fmtPct(b.conversionRate)}</td>
                              <td className="py-1.5 text-blue-800 text-right font-medium">{fmt(b.predictedValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 3. Detail cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Conversion Rate", value: fmtPct(m.conversionRate), sub: `${m.completedDrafts} of ${m.totalDrafts} drafts` },
                { label: "Avg Cycle Time", value: m.avgCycleTimeDays > 0 ? `${m.avgCycleTimeDays}d` : "N/A", sub: "Draft to order" },
                { label: "Avg Sale", value: fmt(m.avgSaleValue), sub: `From ${m.completedDrafts} completed` },
                { label: "Value Win Rate", value: fmtPct(m.valueWinRate), sub: "Completed $ / quoted $" },
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
