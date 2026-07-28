"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  BarChart,
  Bar,
} from "recharts";

// Extracted from CustomerServiceDashboard and loaded via next/dynamic so
// recharts stays out of the route's initial bundle (same pattern as ShopifyCharts).

interface HistoryPoint {
  date: string;
  total_calls: number;
  inbound: number;
  outbound: number;
  missed: number;
  vm_calls: number;
  miss_rate: number;
}

interface HourlyPoint {
  hour: number;
  label: string;
  total_calls: number;
  inbound: number;
  missed: number;
  answered: number;
  miss_rate: number;
}

function formatShortDate(label: unknown) {
  const dateStr = String(label);
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CallVolumeChart({ history }: { history: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={history}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 11, fill: "#a39e93" }}
        />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} />
        <Tooltip
          labelFormatter={formatShortDate}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e0da",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="inbound"
          name="Inbound"
          stackId="1"
          stroke="#5b7a5e"
          fill="#5b7a5e"
          fillOpacity={0.3}
        />
        <Area
          type="monotone"
          dataKey="outbound"
          name="Outbound"
          stackId="1"
          stroke="#8b7355"
          fill="#8b7355"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MissRateChart({ history }: { history: HistoryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fontSize: 11, fill: "#a39e93" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#a39e93" }}
          unit="%"
        />
        <Tooltip
          labelFormatter={formatShortDate}
          formatter={(value) => [`${value}%`, "Miss Rate"]}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e0da",
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="miss_rate"
          name="Miss Rate"
          stroke="#c0392b"
          strokeWidth={2}
          dot={{ r: 3, fill: "#c0392b" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursChart({ hourly }: { hourly: HourlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={hourly.filter((h) => h.hour >= 8 && h.hour <= 20)}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#a39e93" }}
        />
        <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #e5e0da",
            fontSize: 12,
          }}
          formatter={(value, name) => [value, name]}
        />
        <Bar
          dataKey="answered"
          name="Answered"
          stackId="a"
          fill="#5b7a5e"
          fillOpacity={0.7}
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="missed"
          name="Missed"
          stackId="a"
          fill="#c0392b"
          fillOpacity={0.7}
          radius={[2, 2, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
