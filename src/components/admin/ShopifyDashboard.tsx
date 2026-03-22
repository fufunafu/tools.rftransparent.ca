"use client";

import { useState, useEffect, useCallback } from "react";
import SalesMap from "./SalesMap";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreInfo { id: string; label: string }

interface PeriodMetric { revenue: number; orders: number }

interface Metrics {
  today: PeriodMetric;
  week: PeriodMetric;
  month: PeriodMetric;
  year: PeriodMetric;
  lyMonth: PeriodMetric;
  unpaidOrders: number;
  draftOrders: { today: number; week: number; month: number };
  customers: number;
  currency: string;
}

interface Order {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string; lastName: string } | null;
}

interface ChartPoint { date: string; revenue: number; orders: number }

type LoadState = "idle" | "loading" | "loaded" | "error";

interface StoreState {
  id: string;
  label: string;
  metrics: Metrics | null;
  metricsState: LoadState;
  metricsError?: string;
  orders: Order[];
  ordersState: LoadState;
  ordersError?: string;
  chart: ChartPoint[];
  chartState: LoadState;
  chartRange: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency: string, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(amount);
}

function delta(current: number, reference: number): { pct: number; up: boolean } | null {
  if (!reference) return null;
  const pct = ((current - reference) / reference) * 100;
  return { pct, up: pct >= 0 };
}

function TrendBadge({ pct, up, label }: { pct: number; up: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-green-600" : "text-red-500"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: "bg-green-100 text-green-700",
    PENDING: "bg-yellow-100 text-yellow-700",
    REFUNDED: "bg-red-100 text-red-700",
    VOIDED: "bg-gray-100 text-gray-500",
    FULFILLED: "bg-blue-100 text-blue-700",
    UNFULFILLED: "bg-orange-100 text-orange-700",
    PARTIALLY_FULFILLED: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-sand-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="text-sand-500 mb-1">{label}</p>
      <p className="text-sand-900 font-semibold">${payload[0]?.value?.toLocaleString()}</p>
      {payload[1] && <p className="text-sand-500">{payload[1]?.value} orders</p>}
    </div>
  );
}

const ORDERS_QUERY = `
  query {
    shop { currencyCode }
    orders(first: 20, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id name createdAt
          displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { firstName lastName }
        }
      }
    }
  }
`;

const RANGE_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

// ─── API calls ────────────────────────────────────────────────────────────────

async function apiGetStores(): Promise<StoreInfo[]> {
  const res = await fetch("/api/shopify");
  if (!res.ok) throw new Error("Failed to load stores");
  return (await res.json()).stores;
}

async function apiGetMetrics(storeId: string): Promise<Metrics> {
  const res = await fetch(`/api/shopify/metrics?storeId=${storeId}`);
  if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`); }
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j;
}

async function apiGetOrders(storeId: string): Promise<Order[]> {
  const res = await fetch("/api/shopify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeId, query: ORDERS_QUERY }),
  });
  if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`); }
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.data.orders.edges.map((e: { node: Order }) => e.node);
}

async function apiGetChart(storeId: string, days: number): Promise<ChartPoint[]> {
  const res = await fetch(`/api/shopify/chart?storeId=${storeId}&days=${days}`);
  if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`); }
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.daily;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ShopifyDashboard() {
  const [stores, setStores] = useState<StoreState[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const updateStore = useCallback((id: string, patch: Partial<StoreState>) => {
    setStores((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const loadMetrics = useCallback(async (id: string) => {
    updateStore(id, { metricsState: "loading" });
    try {
      const metrics = await apiGetMetrics(id);
      updateStore(id, { metrics, metricsState: "loaded" });
    } catch (e) {
      updateStore(id, { metricsState: "error", metricsError: e instanceof Error ? e.message : "Error" });
    }
  }, [updateStore]);

  const loadOrders = useCallback(async (id: string) => {
    updateStore(id, { ordersState: "loading" });
    try {
      const orders = await apiGetOrders(id);
      updateStore(id, { orders, ordersState: "loaded" });
    } catch (e) {
      updateStore(id, { ordersState: "error", ordersError: e instanceof Error ? e.message : "Error" });
    }
  }, [updateStore]);

  const loadChart = useCallback(async (id: string, days: number) => {
    updateStore(id, { chartState: "loading", chartRange: days });
    try {
      const chart = await apiGetChart(id, days);
      updateStore(id, { chart, chartState: "loaded" });
    } catch (e) {
      updateStore(id, { chartState: "error" });
    }
  }, [updateStore]);

  const bootstrap = useCallback(async () => {
    setBootstrapError(null);
    let infos: StoreInfo[];
    try { infos = await apiGetStores(); }
    catch (e) { setBootstrapError(e instanceof Error ? e.message : "Failed"); return; }
    if (!infos.length) { setBootstrapError("No stores configured."); return; }

    const initial: StoreState[] = infos.map((s) => ({
      id: s.id, label: s.label,
      metrics: null, metricsState: "idle", orders: [], ordersState: "idle",
      chart: [], chartState: "idle", chartRange: 30,
    }));
    setStores(initial);
    setActiveTab(infos[0].id);
    infos.forEach((s) => loadMetrics(s.id));
    loadOrders(infos[0].id);
    loadChart(infos[0].id, 30);
  }, [loadMetrics, loadOrders, loadChart]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const switchTab = useCallback((id: string) => {
    setActiveTab(id);
    const store = stores.find((s) => s.id === id);
    if (store && store.ordersState === "idle") loadOrders(id);
    if (store && store.chartState === "idle") loadChart(id, store.chartRange);
  }, [stores, loadOrders, loadChart]);

  const refreshAll = useCallback(() => {
    stores.forEach((s) => {
      loadMetrics(s.id);
      if (s.ordersState === "loaded") loadOrders(s.id);
      if (s.chartState === "loaded") loadChart(s.id, s.chartRange);
    });
  }, [stores, loadMetrics, loadOrders, loadChart]);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const loadedStores = stores.filter((s) => s.metricsState === "loaded" && s.metrics);
  const combined = loadedStores.reduce(
    (acc, s) => ({
      revenue: acc.revenue + (s.metrics?.month.revenue ?? 0),
      orders: acc.orders + (s.metrics?.today.orders ?? 0),
      customers: acc.customers + (s.metrics?.customers ?? 0),
    }),
    { revenue: 0, orders: 0, customers: 0 }
  );
  const combinedCurrency = loadedStores[0]?.metrics?.currency ?? "USD";
  const activeStore = stores.find((s) => s.id === activeTab);

  if (bootstrapError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-red-600 text-sm">{bootstrapError}</p>
        <button onClick={bootstrap} className="px-4 py-2 text-sm bg-sand-900 text-white rounded-lg">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-serif font-semibold text-sand-900">Shopify</h2>
        <button onClick={refreshAll} className="px-3 py-1.5 text-xs bg-sand-100 text-sand-600 rounded-lg hover:bg-sand-200 transition-colors">
          Refresh all
        </button>
      </div>

      {/* ── Combined banner ── */}
      {loadedStores.length > 0 && (
        <div className="bg-sand-900 rounded-xl p-5 text-white flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-sand-400 uppercase tracking-wide mb-0.5">Total Revenue (30d)</p>
            <p className="text-2xl font-semibold">{fmt(combined.revenue, combinedCurrency, true)}</p>
          </div>
          <div>
            <p className="text-xs text-sand-400 uppercase tracking-wide mb-0.5">Orders Today</p>
            <p className="text-2xl font-semibold">{combined.orders}</p>
          </div>
          <div>
            <p className="text-xs text-sand-400 uppercase tracking-wide mb-0.5">Customers</p>
            <p className="text-2xl font-semibold">{combined.customers.toLocaleString()}{loadedStores.some(s => (s.metrics?.customers ?? 0) >= 250) ? "+" : ""}</p>
          </div>
          <div className="ml-auto self-center text-xs text-sand-400">
            {loadedStores.length}/{stores.length} stores loaded
          </div>
        </div>
      )}

      {/* ── Store overview cards ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">Stores</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {stores.map((store) => {
            const active = activeTab === store.id;
            const m = store.metrics;
            const yoyDelta = m ? delta(m.month.revenue, m.lyMonth.revenue) : null;
            return (
              <button
                key={store.id}
                onClick={() => switchTab(store.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  active ? "border-sand-900 bg-sand-900 text-white shadow-soft" : "border-sand-200 bg-white hover:border-sand-300 hover:shadow-soft"
                }`}
              >
                <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${active ? "text-sand-400" : "text-sand-400"}`}>
                  {store.label}
                </p>
                {store.metricsState === "loading" && <p className="text-sm animate-pulse text-sand-400">Loading...</p>}
                {store.metricsState === "error" && <p className="text-sm text-red-400">Error</p>}
                {store.metricsState === "loaded" && m && (
                  <>
                    <p className={`text-xl font-semibold ${active ? "text-white" : "text-sand-900"}`}>
                      {fmt(m.month.revenue, m.currency, true)}
                    </p>
                    <p className={`text-xs mt-0.5 ${active ? "text-sand-400" : "text-sand-400"}`}>
                      {m.month.orders} orders · 30d
                    </p>
                    {yoyDelta && (
                      <p className={`text-xs mt-1.5 ${yoyDelta.up ? "text-green-400" : "text-red-400"}`}>
                        {yoyDelta.up ? "▲" : "▼"} {Math.abs(yoyDelta.pct).toFixed(1)}% vs last year
                      </p>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tabs ── */}
      {stores.length > 0 && (
        <div>
          <div className="flex gap-1 border-b border-sand-200 mb-6">
            {stores.map((store) => (
              <button
                key={store.id}
                onClick={() => switchTab(store.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === store.id ? "border-sand-900 text-sand-900" : "border-transparent text-sand-400 hover:text-sand-700"
                }`}
              >
                {store.label}
              </button>
            ))}
          </div>

          {activeStore && (
            <div className="space-y-5">

              {/* ── Metrics grid ── */}
              {activeStore.metricsState === "loading" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {["TODAY", "LAST 7 DAYS", "LAST 30 DAYS", "LAST 365 DAYS"].map((l) => (
                    <div key={l} className="bg-white rounded-xl border border-sand-200 p-4 animate-pulse">
                      <p className="text-xs text-sand-300 mb-2">{l}</p>
                      <div className="h-6 bg-sand-100 rounded w-24 mb-1" />
                      <div className="h-4 bg-sand-100 rounded w-16" />
                    </div>
                  ))}
                </div>
              )}

              {activeStore.metricsState === "error" && (
                <p className="text-red-500 text-sm">{activeStore.metricsError}</p>
              )}

              {activeStore.metricsState === "loaded" && activeStore.metrics && (() => {
                const m = activeStore.metrics!;
                const todayVsAvg = delta(m.today.revenue, m.month.revenue / 30);
                const monthVsLY = delta(m.month.revenue, m.lyMonth.revenue);
                const periods = [
                  { label: "TODAY", metric: m.today, trend: todayVsAvg ? { ...todayVsAvg, label: "vs 30d avg" } : null },
                  { label: "LAST 7 DAYS", metric: m.week, trend: null },
                  { label: "LAST 30 DAYS", metric: m.month, trend: monthVsLY ? { ...monthVsLY, label: "vs last year" } : null },
                  { label: "LAST 365 DAYS", metric: m.year, trend: null },
                ];

                // KPI calculations
                const aov30 = m.month.orders > 0 ? m.month.revenue / m.month.orders : 0;
                const aov7 = m.week.orders > 0 ? m.week.revenue / m.week.orders : 0;
                const revPerDay7 = m.week.revenue / 7;
                const revPerDay30 = m.month.revenue / 30;
                const revPerCustomer = m.customers > 0 ? m.month.revenue / m.customers : 0;
                const conversionMonth = (m.month.orders + m.draftOrders.month) > 0
                  ? (m.month.orders / (m.month.orders + m.draftOrders.month)) * 100
                  : 0;
                const conversionWeek = (m.week.orders + m.draftOrders.week) > 0
                  ? (m.week.orders / (m.week.orders + m.draftOrders.week)) * 100
                  : 0;

                return (
                  <>
                    {/* Period cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {periods.map(({ label, metric, trend }) => (
                        <div key={label} className="bg-white rounded-xl border border-sand-200 p-4">
                          <p className="text-xs text-sand-400 uppercase tracking-wide mb-2">{label}</p>
                          <p className="text-lg font-semibold text-sand-900">{fmt(metric.revenue, m.currency, true)}</p>
                          <p className="text-sm text-sand-500 mt-0.5">{metric.orders} orders</p>
                          {trend && <p className="mt-2"><TrendBadge pct={trend.pct} up={trend.up} label={trend.label} /></p>}
                        </div>
                      ))}
                    </div>

                    {/* KPIs */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">Key Metrics</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-white rounded-xl border border-sand-200 p-4">
                          <p className="text-xs text-sand-400 uppercase tracking-wide mb-2">Avg Order Value</p>
                          <p className="text-lg font-semibold text-sand-900">{fmt(aov30, m.currency)}</p>
                          <p className="text-xs text-sand-400 mt-1">
                            7d: {fmt(aov7, m.currency)}
                            {aov7 > 0 && aov30 > 0 && (() => {
                              const d = delta(aov7, aov30);
                              return d ? <span className={`ml-1 ${d.up ? "text-green-600" : "text-red-500"}`}>{d.up ? "▲" : "▼"}{Math.abs(d.pct).toFixed(0)}%</span> : null;
                            })()}
                          </p>
                        </div>
                        <div className="bg-white rounded-xl border border-sand-200 p-4">
                          <p className="text-xs text-sand-400 uppercase tracking-wide mb-2">Rev / Day Avg</p>
                          <p className="text-lg font-semibold text-sand-900">{fmt(revPerDay30, m.currency)}</p>
                          <p className="text-xs text-sand-400 mt-1">
                            7d avg: {fmt(revPerDay7, m.currency)}
                            {revPerDay7 > 0 && revPerDay30 > 0 && (() => {
                              const d = delta(revPerDay7, revPerDay30);
                              return d ? <span className={`ml-1 ${d.up ? "text-green-600" : "text-red-500"}`}>{d.up ? "▲" : "▼"}{Math.abs(d.pct).toFixed(0)}%</span> : null;
                            })()}
                          </p>
                        </div>
                        <div className="bg-white rounded-xl border border-sand-200 p-4">
                          <p className="text-xs text-sand-400 uppercase tracking-wide mb-2">Quote → Sale</p>
                          <p className="text-lg font-semibold text-sand-900">{conversionMonth.toFixed(1)}%</p>
                          <p className="text-xs text-sand-400 mt-1">
                            {m.month.orders} sold / {m.month.orders + m.draftOrders.month} total
                          </p>
                          <p className="text-xs text-sand-400">
                            7d: {conversionWeek.toFixed(1)}%
                          </p>
                        </div>
                        <div className="bg-white rounded-xl border border-sand-200 p-4">
                          <p className="text-xs text-sand-400 uppercase tracking-wide mb-2">Rev / Customer</p>
                          <p className="text-lg font-semibold text-sand-900">{fmt(revPerCustomer, m.currency)}</p>
                          <p className="text-xs text-sand-400 mt-1">
                            {m.customers.toLocaleString()}{m.customers >= 250 ? "+" : ""} customers (30d)
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Alert row */}
                    <div className="flex flex-wrap gap-3">
                      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm ${m.unpaidOrders > 0 ? "border-orange-200 bg-orange-50 text-orange-700" : "border-sand-200 bg-white text-sand-500"}`}>
                        {m.unpaidOrders > 0 && <span className="text-base">!</span>}
                        <span><span className="font-semibold">{m.unpaidOrders}</span> unpaid {m.unpaidOrders === 1 ? "order" : "orders"}</span>
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-sand-200 bg-white text-sm text-sand-600">
                        Draft orders: <span className="font-semibold ml-1">{m.draftOrders.today}</span> today · <span className="font-semibold">{m.draftOrders.week}</span> this week · <span className="font-semibold">{m.draftOrders.month}</span> this month
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* ── Revenue chart ── */}
              <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-sand-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-sand-900">Revenue</h3>
                  <div className="flex gap-1">
                    {RANGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        onClick={() => loadChart(activeStore.id, opt.days)}
                        className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                          activeStore.chartRange === opt.days
                            ? "bg-sand-900 text-white"
                            : "bg-sand-100 text-sand-500 hover:bg-sand-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="px-5 py-4">
                  {activeStore.chartState === "loading" && (
                    <div className="h-64 flex items-center justify-center text-sand-400 text-sm animate-pulse">Loading chart...</div>
                  )}
                  {activeStore.chartState === "error" && (
                    <div className="h-64 flex items-center justify-center text-red-500 text-sm">Failed to load chart</div>
                  )}
                  {activeStore.chartState === "loaded" && activeStore.chart.length > 0 && (
                    <div className="space-y-6">
                      {/* Revenue area chart */}
                      <div>
                        <p className="text-xs text-sand-400 mb-2">Daily Revenue</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={activeStore.chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#1c1917" stopOpacity={0.12} />
                                <stop offset="100%" stopColor="#1c1917" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: "#a8a29e" }}
                              tickFormatter={(d: string) => {
                                const date = new Date(d + "T00:00:00");
                                return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                              }}
                              interval={activeStore.chartRange <= 30 ? 6 : activeStore.chartRange <= 90 ? 13 : 29}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: "#a8a29e" }}
                              tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                              width={50}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            <Area type="monotone" dataKey="revenue" stroke="#1c1917" strokeWidth={2} fill="url(#revGrad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Orders bar chart */}
                      <div>
                        <p className="text-xs text-sand-400 mb-2">Daily Orders</p>
                        <ResponsiveContainer width="100%" height={140}>
                          <BarChart data={activeStore.chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10, fill: "#a8a29e" }}
                              tickFormatter={(d: string) => {
                                const date = new Date(d + "T00:00:00");
                                return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                              }}
                              interval={activeStore.chartRange <= 30 ? 6 : activeStore.chartRange <= 90 ? 13 : 29}
                            />
                            <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} width={30} allowDecimals={false} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar dataKey="orders" fill="#d6d3d1" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  {activeStore.chartState === "loaded" && activeStore.chart.length === 0 && (
                    <div className="h-64 flex items-center justify-center text-sand-400 text-sm">No data for this period</div>
                  )}
                </div>
              </div>

              {/* ── Sales Map & Reps ── */}
              <SalesMap storeId={activeStore.id} />

              {/* ── Orders table ── */}
              <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-sand-100">
                  <h3 className="text-sm font-semibold text-sand-900">Recent Orders — {activeStore.label}</h3>
                </div>
                {activeStore.ordersState === "loading" && (
                  <div className="px-5 py-8 text-center text-sand-400 text-sm animate-pulse">Loading orders...</div>
                )}
                {activeStore.ordersState === "error" && (
                  <div className="px-5 py-8 text-center text-red-500 text-sm">{activeStore.ordersError}</div>
                )}
                {activeStore.ordersState === "loaded" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-sand-100 bg-sand-50">
                          <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">Order</th>
                          <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">Customer</th>
                          <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">Date</th>
                          <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">Payment</th>
                          <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">Fulfillment</th>
                          <th className="text-right px-5 py-3 text-xs text-sand-400 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeStore.orders.length === 0 ? (
                          <tr><td colSpan={6} className="px-5 py-8 text-center text-sand-400 text-sm">No orders found</td></tr>
                        ) : (
                          activeStore.orders.map((order) => (
                            <tr key={order.id} className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors">
                              <td className="px-5 py-3 font-mono text-sand-700">{order.name}</td>
                              <td className="px-5 py-3 text-sand-600">
                                {order.customer
                                  ? `${order.customer.firstName} ${order.customer.lastName}`
                                  : <span className="text-sand-300">Guest</span>}
                              </td>
                              <td className="px-5 py-3 text-sand-400">
                                {new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </td>
                              <td className="px-5 py-3"><StatusBadge status={order.displayFinancialStatus} /></td>
                              <td className="px-5 py-3"><StatusBadge status={order.displayFulfillmentStatus} /></td>
                              <td className="px-5 py-3 text-right font-medium text-sand-900">
                                {new Intl.NumberFormat("en-US", {
                                  style: "currency",
                                  currency: order.totalPriceSet.shopMoney.currencyCode,
                                }).format(parseFloat(order.totalPriceSet.shopMoney.amount))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
