"use client";

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

// Extracted from AccountingDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).

interface TrendPoint {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orders: number;
}

interface ProductChartPoint {
  name: string;
  fullName: string;
  value: number;
}

function fmt(amount: number, currency: string, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(amount);
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

export function RevenueCostTrendChart({
  trend,
  days,
}: {
  trend: TrendPoint[];
  days: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={trend}
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
  );
}

export function MarginTrendChart({
  trend,
  days,
}: {
  trend: TrendPoint[];
  days: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        data={trend}
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
  );
}

export function TopProductsChart({
  chartData,
  chartMetric,
  currency,
}: {
  chartData: ProductChartPoint[];
  chartMetric: "profit" | "margin";
  currency: string;
}) {
  return (
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
  );
}
