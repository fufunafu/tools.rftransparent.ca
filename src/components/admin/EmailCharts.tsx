"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// Extracted from EmailDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).

interface HistoryPoint {
  date: string;
  inbound: number;
  outbound: number;
  total: number;
}

function formatShortDate(label: unknown) {
  if (typeof label !== "string") return "";
  const d = new Date(label + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EmailVolumeChart({ history }: { history: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0db" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 11, fill: "#a09888" }} />
        <YAxis tick={{ fontSize: 11, fill: "#a09888" }} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #e5e0db", fontSize: 12 }}
          labelFormatter={formatShortDate}
        />
        <Area type="monotone" dataKey="inbound" name="Inbound" stackId="1" stroke="#5b7a5e" fill="#5b7a5e" fillOpacity={0.3} />
        <Area type="monotone" dataKey="outbound" name="Outbound" stackId="1" stroke="#8b7355" fill="#8b7355" fillOpacity={0.3} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
