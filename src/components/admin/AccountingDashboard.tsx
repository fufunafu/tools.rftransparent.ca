"use client";

import { useState, useEffect, useCallback } from "react";
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

interface StoreInfo {
  id: string;
  label: string;
}

interface OrderData {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  customer: string;
  revenue: number;
  cost: number | null;
  profit: number | null;
  margin: number | null;
  daysToPayment: number | null;
  currency: string;
}

interface DSOData {
  avgDays: number | null;
  weightedAvgDays: number | null;
  paidOrderCount: number;
  previousAvgDays: number | null;
  distribution: {
    sameDay: number;
    within7: number;
    within30: number;
    within60: number;
    over60: number;
  };
}

interface UnpaidOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  customer: string;
  amount: number;
  currency: string;
  daysPending: number;
}

interface TrendPoint {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orders: number;
}

interface ProductMarginRow {
  productTitle: string;
  productType: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  hasCostData: boolean;
}

interface AccountingData {
  summary: {
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    avgMargin: number | null;
    orderCount: number;
    ordersWithCostData: number;
    currency: string;
  };
  previous: {
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    avgMargin: number | null;
    orderCount: number;
  };
  orders: OrderData[];
  unpaid: {
    orders: UnpaidOrder[];
    totalUnpaid: number;
    count: number;
  };
  trend: TrendPoint[];
  products: ProductMarginRow[];
  dso: DSOData;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

// ─── Goals (configurable) ─────────────────────────────────────────────────────

const GOALS = {
  profitMargin: 40, // target % profit margin
  monthlyRevenue: 50000, // target monthly revenue
  maxUnpaidOrders: 5, // max acceptable unpaid orders
  collectionDays: 30, // max days before flagging
  dso: 30, // target days sales outstanding
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number, currency: string, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(amount);
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sand-300">&mdash;</span>;
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium ${
        up ? "text-green-600" : "text-red-500"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: "bg-green-100 text-green-700",
    PENDING: "bg-yellow-100 text-yellow-700",
    PARTIALLY_PAID: "bg-orange-100 text-orange-700",
    REFUNDED: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        colors[status] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  );
}

// ─── Info Tooltip ─────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1 cursor-help">
      <span className="w-3.5 h-3.5 rounded-full border border-sand-300 text-sand-400 text-[9px] font-bold inline-flex items-center justify-center leading-none">
        ?
      </span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-sand-900 text-sand-50 text-[11px] leading-snug w-52 text-center opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg">
        {text}
      </span>
    </span>
  );
}

// ─── Goal Meter ───────────────────────────────────────────────────────────────

function GoalMeter({
  label,
  current,
  target,
  format,
  invertColor,
  info,
}: {
  label: string;
  current: number;
  target: number;
  format: (v: number) => string;
  invertColor?: boolean;
  info?: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const isGood = invertColor ? current <= target : current >= target;
  const barColor = isGood ? "bg-green-500" : pct > 60 ? "bg-yellow-500" : "bg-red-400";

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
          {label}
          {info && <InfoTip text={info} />}
        </p>
        <p className="text-xs text-sand-400">
          Goal: {format(target)}
        </p>
      </div>
      <p className="text-xl font-semibold text-sand-900 mb-3">{format(current)}</p>
      <div className="w-full bg-sand-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-sand-400 mt-1.5">
        {pct.toFixed(0)}% of goal
        {isGood && (
          <span className="ml-1 text-green-600 font-medium">— On track</span>
        )}
      </p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-sand-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="text-sand-500 mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.name === "margin" ? `${p.value}%` : `$${p.value.toLocaleString()}`}
        </p>
      ))}
    </div>
  );
}

// ─── Collection Level Badge ───────────────────────────────────────────────────

function CollectionLevel({ daysPending }: { daysPending: number }) {
  if (daysPending >= 90) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        90+ days — Critical
      </span>
    );
  }
  if (daysPending >= 60) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
        60+ days — Escalated
      </span>
    );
  }
  if (daysPending >= 30) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        30+ days — Follow-up
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      {daysPending}d — New
    </span>
  );
}

// ─── Range options ────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountingDashboard() {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [activeStore, setActiveStore] = useState<string>("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AccountingData | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState<"margin" | "revenue" | "profit">("margin");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [view, setView] = useState<"overview" | "orders" | "collections" | "products">("overview");

  // Load stores
  useEffect(() => {
    fetch("/api/shopify")
      .then((r) => r.json())
      .then((d) => {
        setStores(d.stores ?? []);
        if (d.stores?.length > 0) setActiveStore(d.stores[0].id);
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!activeStore) return;
    setState("loading");
    setError("");
    try {
      const res = await fetch(
        `/api/shopify/accounting?storeId=${activeStore}&days=${days}`
      );
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json: AccountingData = await res.json();
      setData(json);
      setState("loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [activeStore, days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSort = (col: "margin" | "revenue" | "profit") => {
    if (sortBy === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const sortedOrders = data
    ? [...data.orders]
        .filter((o) => o.cost !== null)
        .sort((a, b) => {
          const aVal = a[sortBy] ?? 0;
          const bVal = b[sortBy] ?? 0;
          return sortDir === "desc" ? bVal - aVal : aVal - bVal;
        })
    : [];

  const currency = data?.summary.currency ?? "USD";

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Store picker */}
        {stores.length > 1 && (
          <select
            value={activeStore}
            onChange={(e) => setActiveStore(e.target.value)}
            className="rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-700 bg-white"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}

        {/* Range picker */}
        <div className="flex rounded-lg border border-sand-200 overflow-hidden">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                days === opt.days
                  ? "bg-sand-900 text-sand-50"
                  : "bg-white text-sand-600 hover:bg-sand-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* View switcher */}
        <div className="flex rounded-lg border border-sand-200 overflow-hidden">
          {(
            [
              { v: "overview", l: "Overview" },
              { v: "orders", l: "Orders" },
              { v: "collections", l: "Collections" },
              { v: "products", l: "Products" },
            ] as { v: typeof view; l: string }[]
          ).map((opt) => (
            <button
              key={opt.v}
              onClick={() => setView(opt.v)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                view === opt.v
                  ? "bg-sand-900 text-sand-50"
                  : "bg-white text-sand-600 hover:bg-sand-50"
              }`}
            >
              {opt.l}
            </button>
          ))}
        </div>

        <button
          onClick={loadData}
          disabled={state === "loading"}
          className="ml-auto px-4 py-2 text-sm font-medium rounded-lg bg-sand-900 text-sand-50 hover:bg-sand-800 transition-colors disabled:opacity-50"
        >
          {state === "loading" ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {state === "loading" && !data && (
        <div className="text-center py-12 text-sand-400 animate-pulse">
          Loading accounting data...
        </div>
      )}

      {state === "loaded" && data && view === "overview" && (
        <OverviewView data={data} currency={currency} days={days} />
      )}

      {state === "loaded" && data && view === "orders" && (
        <OrdersView
          orders={sortedOrders}
          allOrders={data.orders}
          currency={currency}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      {state === "loaded" && data && view === "collections" && (
        <CollectionsView data={data} currency={currency} />
      )}

      {state === "loaded" && data && view === "products" && (
        <ProductsView products={data.products} currency={currency} />
      )}
    </div>
  );
}

// ─── Overview View ────────────────────────────────────────────────────────────

function OverviewView({
  data,
  currency,
  days,
}: {
  data: AccountingData;
  currency: string;
  days: number;
}) {
  const s = data.summary;
  const p = data.previous;

  const revenueChange = pctChange(s.totalRevenue, p.totalRevenue);
  const profitChange = pctChange(s.totalProfit, p.totalProfit);
  const marginChange =
    s.avgMargin !== null && p.avgMargin !== null
      ? s.avgMargin - p.avgMargin
      : null;

  // Extrapolate monthly revenue from current period
  const dailyAvgRevenue = days > 0 ? s.totalRevenue / days : 0;
  const projectedMonthlyRevenue = dailyAvgRevenue * 30;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
            Revenue
            <InfoTip text="Net revenue = Subtotal (after discounts, before tax/shipping) minus shipping cost metafield minus US export tariff metafield. Includes all payment statuses." />
          </p>
          <p className="text-xl font-semibold text-sand-900 mt-1">
            {fmt(s.totalRevenue, currency, true)}
          </p>
          <p className="text-xs text-sand-400 mt-0.5">{s.orderCount} orders</p>
          <div className="mt-1">
            <TrendBadge value={revenueChange} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
            Cost of Goods
            <InfoTip text="Sum of (unitCost x quantity) for each line item. Only orders with cost data in Shopify product variants are included." />
          </p>
          <p className="text-xl font-semibold text-sand-900 mt-1">
            {fmt(s.totalCost, currency, true)}
          </p>
          <p className="text-xs text-sand-400 mt-1">
            {s.ordersWithCostData}/{s.orderCount} orders with cost data
          </p>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
            Gross Profit
            <InfoTip text="Net Revenue minus Cost of Goods. Only calculated for orders that have cost data on their product variants." />
          </p>
          <p
            className={`text-xl font-semibold mt-1 ${
              s.totalProfit >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {fmt(s.totalProfit, currency, true)}
          </p>
          <div className="mt-1">
            <TrendBadge value={profitChange} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
            Profit Margin
            <InfoTip text="(Net Revenue - Cost) / Net Revenue as a %. Uses all net revenue but only cost from orders with cost data." />
          </p>
          <p
            className={`text-xl font-semibold mt-1 ${
              (s.avgMargin ?? 0) >= GOALS.profitMargin
                ? "text-green-700"
                : "text-sand-900"
            }`}
          >
            {s.avgMargin !== null ? `${s.avgMargin.toFixed(1)}%` : "—"}
          </p>
          {marginChange !== null && (
            <div className="mt-1">
              <span
                className={`text-xs font-medium ${
                  marginChange >= 0 ? "text-green-600" : "text-red-500"
                }`}
              >
                {marginChange >= 0 ? "▲" : "▼"} {Math.abs(marginChange).toFixed(1)}pp
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Goal meters */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
          Goals
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <GoalMeter
            label="Profit Margin"
            current={s.avgMargin ?? 0}
            target={GOALS.profitMargin}
            format={(v) => `${v.toFixed(1)}%`}
          />
          <GoalMeter
            label="Projected Monthly Revenue"
            current={projectedMonthlyRevenue}
            target={GOALS.monthlyRevenue}
            format={(v) => fmt(v, currency, true)}
            info="Extrapolated from (total revenue / days in period) x 30. Not a forecast — just a run-rate projection."
          />
          <GoalMeter
            label="Unpaid Orders"
            current={data.unpaid.count}
            target={GOALS.maxUnpaidOrders}
            format={(v) => `${v}`}
            invertColor
          />
          <GoalMeter
            label="Avg DSO"
            current={data.dso.avgDays ?? 0}
            target={GOALS.dso}
            format={(v) => `${v.toFixed(1)}d`}
            invertColor
            info="Average days from order creation to payment. Lower is better — shows how fast you collect."
          />
        </div>
      </div>

      {/* Unpaid alert */}
      {data.unpaid.count > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-orange-200 bg-orange-50">
          <span className="text-orange-600 text-lg font-bold">!</span>
          <div>
            <p className="text-sm font-medium text-orange-800">
              {data.unpaid.count} unpaid order{data.unpaid.count !== 1 ? "s" : ""} totaling{" "}
              {fmt(data.unpaid.totalUnpaid, currency)}
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              {data.unpaid.orders.filter((o) => o.daysPending >= 30).length} overdue (30+ days)
              {" · "}
              {data.unpaid.orders.filter((o) => o.daysPending >= 60).length} escalated (60+ days)
              {" · "}
              {data.unpaid.orders.filter((o) => o.daysPending >= 90).length} critical (90+ days)
            </p>
          </div>
        </div>
      )}

      {/* Profit margin trend chart */}
      {data.trend.length > 0 && (
        <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-sand-100">
            <h3 className="text-sm font-semibold text-sand-900 flex items-center">
              Revenue vs Cost of Goods
              <InfoTip text="Revenue = net revenue (subtotal - shipping cost - export tariff). Cost = sum of product variant unit costs. Days with no cost data show $0 cost." />
            </h3>
          </div>
          <div className="px-5 py-4">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={data.trend}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="revGradAcct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a34a" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="costGradAcct" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  tickFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                  interval={days <= 30 ? 6 : days <= 90 ? 13 : 29}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  tickFormatter={(v: number) =>
                    `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
                  }
                  width={50}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#16a34a"
                  strokeWidth={2}
                  fill="url(#revGradAcct)"
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  name="Cost"
                  stroke="#dc2626"
                  strokeWidth={2}
                  fill="url(#costGradAcct)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Margin trend chart */}
      {data.trend.length > 0 && (
        <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-sand-100">
            <h3 className="text-sm font-semibold text-sand-900">
              Daily Profit Margin %
            </h3>
          </div>
          <div className="px-5 py-4">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={data.trend}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  tickFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                  interval={days <= 30 ? 6 : days <= 90 ? 13 : 29}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={40}
                  domain={[0, 100]}
                />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar dataKey="margin" name="margin" fill="#16a34a" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Orders View ──────────────────────────────────────────────────────────────

function OrdersView({
  orders,
  allOrders,
  currency,
  sortBy,
  sortDir,
  onSort,
}: {
  orders: OrderData[];
  allOrders: OrderData[];
  currency: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: "margin" | "revenue" | "profit") => void;
}) {
  const noCostOrders = allOrders.filter((o) => o.cost === null);

  return (
    <div className="space-y-4">
      {noCostOrders.length > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700">
          {noCostOrders.length} order{noCostOrders.length !== 1 ? "s" : ""} missing
          cost data — add product costs in Shopify to see margins for all orders.
        </div>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-sand-100">
          <h3 className="text-sm font-semibold text-sand-900">
            Order Profit Margins ({orders.length} orders with cost data)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50">
                <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                  Order
                </th>
                <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                  Customer
                </th>
                <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                  Date
                </th>
                <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                  Status
                </th>
                <th
                  onClick={() => onSort("revenue")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Revenue
                  {sortBy === "revenue" && (
                    <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>
                  )}
                </th>
                <th className="text-right px-5 py-3 text-xs text-sand-400 font-medium">
                  Cost
                </th>
                <th
                  onClick={() => onSort("profit")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Profit
                  {sortBy === "profit" && (
                    <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>
                  )}
                </th>
                <th
                  onClick={() => onSort("margin")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Margin
                  {sortBy === "margin" && (
                    <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-8 text-center text-sand-400"
                  >
                    No orders with cost data found. Add product costs in Shopify
                    to see profit margins.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-sand-700">
                      {order.name}
                    </td>
                    <td className="px-5 py-3 text-sand-600">{order.customer}</td>
                    <td className="px-5 py-3 text-sand-400">
                      {new Date(order.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={order.financialStatus} />
                    </td>
                    <td className="px-5 py-3 text-right text-sand-900">
                      {fmt(order.revenue, currency)}
                    </td>
                    <td className="px-5 py-3 text-right text-sand-500">
                      {order.cost !== null ? fmt(order.cost, currency) : "—"}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-medium ${
                        (order.profit ?? 0) >= 0
                          ? "text-green-700"
                          : "text-red-600"
                      }`}
                    >
                      {order.profit !== null ? fmt(order.profit, currency) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {order.margin !== null ? (
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            order.margin >= GOALS.profitMargin
                              ? "bg-green-100 text-green-700"
                              : order.margin >= 20
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {order.margin.toFixed(1)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Collections View ─────────────────────────────────────────────────────────

function CollectionsView({
  data,
  currency,
}: {
  data: AccountingData;
  currency: string;
}) {
  const unpaid = data.unpaid;
  const critical = unpaid.orders.filter((o) => o.daysPending >= 90);
  const escalated = unpaid.orders.filter(
    (o) => o.daysPending >= 60 && o.daysPending < 90
  );
  const followUp = unpaid.orders.filter(
    (o) => o.daysPending >= 30 && o.daysPending < 60
  );
  const recent = unpaid.orders.filter((o) => o.daysPending < 30);

  const buckets = [
    {
      label: "Critical (90+ days)",
      orders: critical,
      color: "border-red-200 bg-red-50",
      headerColor: "text-red-800",
    },
    {
      label: "Escalated (60-89 days)",
      orders: escalated,
      color: "border-orange-200 bg-orange-50",
      headerColor: "text-orange-800",
    },
    {
      label: "Follow-up (30-59 days)",
      orders: followUp,
      color: "border-yellow-200 bg-yellow-50",
      headerColor: "text-yellow-800",
    },
    {
      label: "Recent (<30 days)",
      orders: recent,
      color: "border-blue-200 bg-blue-50",
      headerColor: "text-blue-800",
    },
  ];

  const dso = data.dso;
  const dsoChange =
    dso.avgDays !== null && dso.previousAvgDays !== null
      ? dso.previousAvgDays - dso.avgDays // positive = improved (fewer days)
      : null;
  const distTotal = dso.paidOrderCount || 1; // avoid div by zero

  return (
    <div className="space-y-6">
      {/* DSO Section */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-sand-400 mb-3">
          Days Sales Outstanding (DSO)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-sand-200/60 p-4">
            <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
              Avg DSO
              <InfoTip text="Average days from order creation to payment completion for paid orders in this period." />
            </p>
            <p className="text-xl font-semibold text-sand-900 mt-1">
              {dso.avgDays !== null ? `${dso.avgDays}d` : "—"}
            </p>
            {dsoChange !== null && (
              <div className="mt-1">
                <span
                  className={`text-xs font-medium ${
                    dsoChange >= 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {dsoChange >= 0 ? "▲" : "▼"} {Math.abs(dsoChange).toFixed(1)}d
                  <span className="text-sand-400 font-normal ml-1">vs prev</span>
                </span>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl border border-sand-200/60 p-4">
            <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
              Weighted DSO
              <InfoTip text="Revenue-weighted average: larger orders have more influence on this number." />
            </p>
            <p className="text-xl font-semibold text-sand-900 mt-1">
              {dso.weightedAvgDays !== null ? `${dso.weightedAvgDays}d` : "—"}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-sand-200/60 p-4">
            <p className="text-xs text-sand-400 uppercase tracking-wider">Paid Orders</p>
            <p className="text-xl font-semibold text-sand-900 mt-1">{dso.paidOrderCount}</p>
            <p className="text-xs text-sand-400 mt-1">used for DSO calc</p>
          </div>
          <GoalMeter
            label="DSO Target"
            current={dso.avgDays ?? 0}
            target={GOALS.dso}
            format={(v) => `${v.toFixed(1)}d`}
            invertColor
            info="Lower is better. Target is maximum acceptable days to collect payment."
          />
        </div>

        {/* DSO distribution */}
        {dso.paidOrderCount > 0 && (
          <div className="mt-3 bg-white rounded-xl border border-sand-200/60 p-4">
            <p className="text-xs text-sand-400 uppercase tracking-wider mb-3">
              Payment Speed Distribution
            </p>
            <div className="flex h-6 rounded-full overflow-hidden">
              {[
                { count: dso.distribution.sameDay, label: "Same day", color: "bg-green-500" },
                { count: dso.distribution.within7, label: "1-7d", color: "bg-green-300" },
                { count: dso.distribution.within30, label: "7-30d", color: "bg-yellow-400" },
                { count: dso.distribution.within60, label: "30-60d", color: "bg-orange-400" },
                { count: dso.distribution.over60, label: "60+d", color: "bg-red-400" },
              ]
                .filter((b) => b.count > 0)
                .map((b) => (
                  <div
                    key={b.label}
                    className={`${b.color} relative group transition-all`}
                    style={{ width: `${(b.count / distTotal) * 100}%` }}
                  >
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg bg-sand-900 text-sand-50 text-[11px] leading-snug whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg">
                      {b.label}: {b.count} ({Math.round((b.count / distTotal) * 100)}%)
                    </span>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {[
                { count: dso.distribution.sameDay, label: "Same day", color: "bg-green-500" },
                { count: dso.distribution.within7, label: "1-7d", color: "bg-green-300" },
                { count: dso.distribution.within30, label: "7-30d", color: "bg-yellow-400" },
                { count: dso.distribution.within60, label: "30-60d", color: "bg-orange-400" },
                { count: dso.distribution.over60, label: "60+d", color: "bg-red-400" },
              ].map((b) => (
                <span key={b.label} className="flex items-center gap-1.5 text-xs text-sand-500">
                  <span className={`w-2.5 h-2.5 rounded-full ${b.color}`} />
                  {b.label}: {b.count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Unpaid summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider">
            Total Unpaid
          </p>
          <p className="text-xl font-semibold text-sand-900 mt-1">
            {fmt(unpaid.totalUnpaid, currency, true)}
          </p>
          <p className="text-xs text-sand-400 mt-1">
            {unpaid.count} order{unpaid.count !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-red-200/60 p-4">
          <p className="text-xs text-red-400 uppercase tracking-wider">
            Critical (90+d)
          </p>
          <p className="text-xl font-semibold text-red-700 mt-1">
            {critical.length}
          </p>
          <p className="text-xs text-red-400 mt-1">
            {fmt(
              critical.reduce((s, o) => s + o.amount, 0),
              currency,
              true
            )}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-orange-200/60 p-4">
          <p className="text-xs text-orange-400 uppercase tracking-wider">
            Escalated (60+d)
          </p>
          <p className="text-xl font-semibold text-orange-700 mt-1">
            {escalated.length}
          </p>
          <p className="text-xs text-orange-400 mt-1">
            {fmt(
              escalated.reduce((s, o) => s + o.amount, 0),
              currency,
              true
            )}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-yellow-200/60 p-4">
          <p className="text-xs text-yellow-500 uppercase tracking-wider">
            Follow-up (30+d)
          </p>
          <p className="text-xl font-semibold text-yellow-700 mt-1">
            {followUp.length}
          </p>
          <p className="text-xs text-yellow-500 mt-1">
            {fmt(
              followUp.reduce((s, o) => s + o.amount, 0),
              currency,
              true
            )}
          </p>
        </div>
      </div>

      {/* Collection buckets */}
      {unpaid.count === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <p className="text-green-700 font-medium">All orders are paid!</p>
          <p className="text-green-600 text-sm mt-1">No outstanding collections.</p>
        </div>
      ) : (
        buckets
          .filter((b) => b.orders.length > 0)
          .map((bucket) => (
            <div
              key={bucket.label}
              className={`rounded-xl border overflow-hidden ${bucket.color}`}
            >
              <div className="px-5 py-3 border-b border-inherit">
                <h3
                  className={`text-sm font-semibold ${bucket.headerColor}`}
                >
                  {bucket.label} ({bucket.orders.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-inherit">
                      <th className="text-left px-5 py-2.5 text-xs font-medium opacity-60">
                        Order
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium opacity-60">
                        Customer
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium opacity-60">
                        Date
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium opacity-60">
                        Status
                      </th>
                      <th className="text-left px-5 py-2.5 text-xs font-medium opacity-60">
                        Collection Level
                      </th>
                      <th className="text-right px-5 py-2.5 text-xs font-medium opacity-60">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-inherit last:border-0"
                      >
                        <td className="px-5 py-3 font-mono">{order.name}</td>
                        <td className="px-5 py-3">{order.customer}</td>
                        <td className="px-5 py-3 opacity-60">
                          {new Date(order.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" }
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={order.financialStatus} />
                        </td>
                        <td className="px-5 py-3">
                          <CollectionLevel daysPending={order.daysPending} />
                        </td>
                        <td className="px-5 py-3 text-right font-medium">
                          {fmt(order.amount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
      )}
    </div>
  );
}

// ─── Products View ─────────────────────────────────────────────────────────

type ProductSortKey = "revenue" | "cost" | "profit" | "margin" | "unitsSold";

function ProductsView({
  products,
  currency,
}: {
  products: ProductMarginRow[];
  currency: string;
}) {
  const [sortBy, setSortBy] = useState<ProductSortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupByType, setGroupByType] = useState(false);
  const [chartMetric, setChartMetric] = useState<"profit" | "margin">("profit");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  const withCost = products.filter((p) => p.hasCostData);
  const noCostCount = products.length - withCost.length;

  const handleSort = (col: ProductSortKey) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const sorted = [...products].sort((a, b) => {
    const aVal = a[sortBy] ?? -Infinity;
    const bVal = b[sortBy] ?? -Infinity;
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  // Group by product type
  const typeGroups = groupByType
    ? Array.from(
        sorted.reduce((map, p) => {
          const group = map.get(p.productType) ?? [];
          group.push(p);
          map.set(p.productType, group);
          return map;
        }, new Map<string, ProductMarginRow[]>())
      ).map(([type, items]) => {
        const revenue = items.reduce((s, p) => s + p.revenue, 0);
        const cost = items.reduce((s, p) => s + p.cost, 0);
        const units = items.reduce((s, p) => s + p.unitsSold, 0);
        const hasCost = items.some((p) => p.hasCostData);
        return {
          type,
          items,
          revenue: Math.round(revenue * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round((revenue - cost) * 100) / 100,
          margin: hasCost && revenue > 0 ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : null,
          units,
        };
      }).sort((a, b) => b.revenue - a.revenue)
    : null;

  const toggleType = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Chart data: top 15 products with cost data
  const chartData = [...withCost]
    .sort((a, b) =>
      chartMetric === "profit" ? b.profit - a.profit : (b.margin ?? 0) - (a.margin ?? 0)
    )
    .slice(0, 15)
    .reverse()
    .map((p) => ({
      name: p.productTitle.length > 28 ? p.productTitle.slice(0, 26) + "…" : p.productTitle,
      fullName: p.productTitle,
      value: chartMetric === "profit" ? p.profit : p.margin ?? 0,
    }));

  // Summary stats
  const highestMargin = withCost.length > 0
    ? withCost.reduce((best, p) => ((p.margin ?? -Infinity) > (best.margin ?? -Infinity) ? p : best))
    : null;
  const lowestMargin = withCost.length > 0
    ? withCost.reduce((worst, p) => ((p.margin ?? Infinity) < (worst.margin ?? Infinity) ? p : worst))
    : null;

  const sortArrow = (col: ProductSortKey) =>
    sortBy === col ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider">Total Products</p>
          <p className="text-xl font-semibold text-sand-900 mt-1">{products.length}</p>
          <p className="text-xs text-sand-400 mt-1">
            {new Set(products.map((p) => p.productType)).size} categories
          </p>
        </div>
        <div className="bg-white rounded-xl border border-sand-200/60 p-4">
          <p className="text-xs text-sand-400 uppercase tracking-wider flex items-center">
            With Cost Data
            <InfoTip text="Products that have unit cost set on their Shopify variant. Margin can only be calculated for these." />
          </p>
          <p className="text-xl font-semibold text-sand-900 mt-1">
            {withCost.length}/{products.length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-green-200/60 p-4">
          <p className="text-xs text-green-600 uppercase tracking-wider">Highest Margin</p>
          <p className="text-xl font-semibold text-green-700 mt-1">
            {highestMargin?.margin != null ? `${highestMargin.margin.toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-sand-400 mt-1 truncate">
            {highestMargin?.productTitle ?? "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-red-200/60 p-4">
          <p className="text-xs text-red-500 uppercase tracking-wider">Lowest Margin</p>
          <p className="text-xl font-semibold text-red-600 mt-1">
            {lowestMargin?.margin != null ? `${lowestMargin.margin.toFixed(1)}%` : "—"}
          </p>
          <p className="text-xs text-sand-400 mt-1 truncate">
            {lowestMargin?.productTitle ?? "—"}
          </p>
        </div>
      </div>

      {noCostCount > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-700">
          {noCostCount} product{noCostCount !== 1 ? "s" : ""} missing cost data — add
          product costs in Shopify to see margins for all products.
        </div>
      )}

      {/* Top products chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-sand-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-sand-900">
              Top 15 Products by {chartMetric === "profit" ? "Profit" : "Margin"}
            </h3>
            <div className="flex rounded-lg border border-sand-200 overflow-hidden">
              {(["profit", "margin"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMetric(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    chartMetric === m
                      ? "bg-sand-900 text-sand-50"
                      : "bg-white text-sand-600 hover:bg-sand-50"
                  }`}
                >
                  {m === "profit" ? "Profit $" : "Margin %"}
                </button>
              ))}
            </div>
          </div>
          <div className="px-5 py-4">
            <ResponsiveContainer width="100%" height={Math.max(chartData.length * 32, 200)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: "#a8a29e" }}
                  tickFormatter={(v: number) =>
                    chartMetric === "profit"
                      ? `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
                      : `${v}%`
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#78716c" }}
                  width={180}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-sand-200 rounded-lg shadow-lg px-3 py-2 text-xs max-w-xs">
                        <p className="font-medium text-sand-900">{d.fullName}</p>
                        <p className="text-sand-600 mt-0.5">
                          {chartMetric === "profit"
                            ? fmt(d.value, currency)
                            : `${d.value.toFixed(1)}%`}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="value"
                  radius={[0, 3, 3, 0]}
                  fill="#16a34a"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setGroupByType(!groupByType)}
          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            groupByType
              ? "bg-sand-900 text-sand-50 border-sand-900"
              : "bg-white text-sand-600 border-sand-200 hover:bg-sand-50"
          }`}
        >
          Group by Type
        </button>
      </div>

      {/* Products table */}
      <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50">
                <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                  Product
                </th>
                {!groupByType && (
                  <th className="text-left px-5 py-3 text-xs text-sand-400 font-medium">
                    Type
                  </th>
                )}
                <th
                  onClick={() => handleSort("unitsSold")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Units{sortArrow("unitsSold")}
                </th>
                <th
                  onClick={() => handleSort("revenue")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Revenue{sortArrow("revenue")}
                </th>
                <th
                  onClick={() => handleSort("cost")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Cost{sortArrow("cost")}
                </th>
                <th
                  onClick={() => handleSort("profit")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Profit{sortArrow("profit")}
                </th>
                <th
                  onClick={() => handleSort("margin")}
                  className="text-right px-5 py-3 text-xs text-sand-400 font-medium cursor-pointer hover:text-sand-700 select-none"
                >
                  Margin{sortArrow("margin")}
                </th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sand-400">
                    No product data found for this period.
                  </td>
                </tr>
              ) : groupByType && typeGroups ? (
                typeGroups.map((group) => (
                  <ProductTypeGroup
                    key={group.type}
                    group={group}
                    currency={currency}
                    expanded={expandedTypes.has(group.type)}
                    onToggle={() => toggleType(group.type)}
                  />
                ))
              ) : (
                sorted.map((p) => (
                  <ProductRow key={p.productTitle} product={p} currency={currency} showType />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductRow({
  product: p,
  currency,
  showType,
  indent,
}: {
  product: ProductMarginRow;
  currency: string;
  showType?: boolean;
  indent?: boolean;
}) {
  return (
    <tr className="border-b border-sand-50 hover:bg-sand-50/50 transition-colors">
      <td className={`px-5 py-3 text-sand-900 ${indent ? "pl-10" : ""}`}>
        {p.productTitle}
      </td>
      {showType && (
        <td className="px-5 py-3 text-sand-400 text-xs">{p.productType}</td>
      )}
      <td className="px-5 py-3 text-right text-sand-600">{p.unitsSold}</td>
      <td className="px-5 py-3 text-right text-sand-900">{fmt(p.revenue, currency)}</td>
      <td className="px-5 py-3 text-right text-sand-500">
        {p.hasCostData ? fmt(p.cost, currency) : "—"}
      </td>
      <td
        className={`px-5 py-3 text-right font-medium ${
          p.hasCostData ? (p.profit >= 0 ? "text-green-700" : "text-red-600") : "text-sand-300"
        }`}
      >
        {p.hasCostData ? fmt(p.profit, currency) : "—"}
      </td>
      <td className="px-5 py-3 text-right">
        {p.margin !== null ? (
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              p.margin >= GOALS.profitMargin
                ? "bg-green-100 text-green-700"
                : p.margin >= 20
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-red-100 text-red-700"
            }`}
          >
            {p.margin.toFixed(1)}%
          </span>
        ) : (
          <span className="text-sand-300">—</span>
        )}
      </td>
    </tr>
  );
}

function ProductTypeGroup({
  group,
  currency,
  expanded,
  onToggle,
}: {
  group: {
    type: string;
    items: ProductMarginRow[];
    revenue: number;
    cost: number;
    profit: number;
    margin: number | null;
    units: number;
  };
  currency: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-sand-100 bg-sand-50/50 cursor-pointer hover:bg-sand-100/50 transition-colors"
      >
        <td className="px-5 py-3 font-medium text-sand-900">
          <span className="mr-2 text-sand-400 text-xs">{expanded ? "▼" : "▶"}</span>
          {group.type}
          <span className="ml-2 text-xs text-sand-400">({group.items.length})</span>
        </td>
        <td className="px-5 py-3 text-right text-sand-600 font-medium">{group.units}</td>
        <td className="px-5 py-3 text-right text-sand-900 font-medium">
          {fmt(group.revenue, currency)}
        </td>
        <td className="px-5 py-3 text-right text-sand-500 font-medium">
          {fmt(group.cost, currency)}
        </td>
        <td
          className={`px-5 py-3 text-right font-medium ${
            group.profit >= 0 ? "text-green-700" : "text-red-600"
          }`}
        >
          {fmt(group.profit, currency)}
        </td>
        <td className="px-5 py-3 text-right">
          {group.margin !== null ? (
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                group.margin >= GOALS.profitMargin
                  ? "bg-green-100 text-green-700"
                  : group.margin >= 20
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {group.margin.toFixed(1)}%
            </span>
          ) : (
            <span className="text-sand-300">—</span>
          )}
        </td>
      </tr>
      {expanded &&
        group.items.map((p) => (
          <ProductRow key={p.productTitle} product={p} currency={currency} indent />
        ))}
    </>
  );
}
