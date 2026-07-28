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

// Extracted from ShopifyDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as SalesMap/SalesMapView).

interface ChartPoint { date: string; revenue: number; orders: number }

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

function formatTick(d: string) {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ShopifyCharts({ chart, chartRange }: { chart: ChartPoint[]; chartRange: number }) {
  const tickInterval = chartRange <= 30 ? 6 : chartRange <= 90 ? 13 : 29;
  return (
    <div className="space-y-6">
      {/* Revenue area chart */}
      <div>
        <p className="text-xs text-sand-400 mb-2">Daily Revenue</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
              tickFormatter={formatTick}
              interval={tickInterval}
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
          <BarChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a8a29e" }}
              tickFormatter={formatTick}
              interval={tickInterval}
            />
            <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} width={30} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="orders" fill="#d6d3d1" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
