"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { formatCADWhole } from "@/lib/format";

// Extracted from EmployeeDetail and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).

interface ChartRow {
  month: string;
  quoted: number;
  sold: number;
  conversion_rate: number;
}

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function QuotedSoldChart({ chartData }: { chartData: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d8" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9c9589" }} />
        <YAxis
          tickFormatter={(v) => fmt$(v as number)}
          tick={{ fontSize: 11, fill: "#9c9589" }}
          width={60}
        />
        <Tooltip
          formatter={(value, name) => [
            formatCADWhole(Number(value ?? 0)),
            name === "quoted" ? "Quoted" : "Sold",
          ]}
          contentStyle={{ fontSize: 12, borderColor: "#e5e1d8" }}
        />
        <Legend
          formatter={(value) => value === "quoted" ? "Quoted" : "Sold"}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="quoted" fill="#d4cfc7" radius={[3, 3, 0, 0]} />
        <Line
          type="monotone"
          dataKey="sold"
          stroke="#2d6a4f"
          strokeWidth={2}
          dot={{ r: 3, fill: "#2d6a4f" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ConversionRateChart({ chartData }: { chartData: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d8" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9c9589" }} />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "#9c9589" }}
          width={45}
          domain={[0, "auto"]}
        />
        <Tooltip
          formatter={(value) => [`${Number(value ?? 0)}%`, "Conv. Rate"]}
          contentStyle={{ fontSize: 12, borderColor: "#e5e1d8" }}
        />
        <Line
          type="monotone"
          dataKey="conversion_rate"
          stroke="#b45309"
          strokeWidth={2}
          dot={{ r: 3, fill: "#b45309" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
