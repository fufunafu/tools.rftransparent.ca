"use client";

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

// Extracted from PipelineDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).
// Each export is a whole chart block (ResponsiveContainer outward). Never
// wrap individual recharts children in dynamic(), chart containers introspect
// their child component types.

// Types mirror PipelineDashboard.

interface ChannelMonthlyTrend {
  month: string;
  draftOrders: number;
  draftRevenue: number;
  directOrders: number;
  directRevenue: number;
  draftRevenueShare: number;
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

interface SeasonalChartPoint {
  month: string;
  monthLabel: string;
  revenue: number;
  momGrowth: number | null;
  momGrowthClamped: number | null;
}

interface MonthlyTrend {
  month: string;
  draftsCreated: number;
  draftsConverted: number;
  conversionRate: number;
  pipelineValue: number;
  revenue: number;
}

// These formatters stay local so the chart bundle remains independent.

const fmt = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(2)}K`
      : `$${n.toFixed(2)}`;

const fmtFull = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tooltipStyle = {
  contentStyle: { backgroundColor: "#faf9f6", border: "1px solid #e5e0d8", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#78736a" },
};

// Chart blocks

/** Monthly channel trend: stacked quote/direct revenue bars + quote share % line. */
export function ChannelTrendChart({ data }: { data: ChannelMonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
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
  );
}

/** Revenue baseline, monthly projections, and the already-visible pipeline. */
export function ForecastChart({
  data,
  startingMonth,
  startingRevenue,
}: {
  data: MonthlyForecast[];
  startingMonth: string;
  startingRevenue: number;
}) {
  const chartData = [
    {
      month: startingMonth,
      monthLabel: startingMonth,
      actual: startingRevenue,
      projected: null,
      fromPipeline: null,
    },
    ...data.map((month) => ({
      ...month,
      actual: null,
      projected: month.forecast,
    })),
  ];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-45} textAnchor="end" height={54} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: unknown, name: unknown) => {
            const v = Number(value);
            const n = String(name);
            if (n === "actual") return [fmtFull(v), "Actual Revenue"];
            if (n === "projected") return [fmtFull(v), "Projected Revenue"];
            if (n === "fromPipeline") return [fmtFull(v), "Already-Visible Pipeline"];
            return [v, n];
          }}
        />
        <Bar dataKey="actual" fill="#16a34a" radius={[5, 5, 0, 0]} name="actual" />
        <Bar dataKey="projected" fill="#2563eb" radius={[5, 5, 0, 0]} name="projected" />
        <Line type="monotone" dataKey="fromPipeline" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3, fill: "#7c3aed" }} connectNulls name="fromPipeline" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Historical seasonal pattern: monthly revenue bars + clamped MoM growth line. */
export function SeasonalPatternChart({ data }: { data: SeasonalChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="monthLabel" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} angle={-45} textAnchor="end" height={50} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v: number) => fmt(v)} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v: number) => `${v}%`} domain={[-100, 100]} />
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
        <Bar yAxisId="left" dataKey="revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="momGrowthClamped" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Monthly trend: won revenue, pending pipeline, and conversion rate. */
export function MonthlyTrendChart({ data }: { data: MonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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
        <Area yAxisId="left" type="monotone" dataKey="revenue" fill="#dcfce7" stroke="#16a34a" fillOpacity={0.35} />
        <Area yAxisId="left" type="monotone" dataKey="pipelineValue" fill="#dbeafe" stroke="#2563eb" fillOpacity={0.28} />
        <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Horizontal stacked bar of draft statuses (open / invoice sent / completed). */
export function StatusBreakdownChart({
  open,
  invoiceSent,
  completed,
}: {
  open: number;
  invoiceSent: number;
  completed: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={60}>
      <BarChart
        layout="vertical"
        data={[{ open, invoiceSent, completed }]}
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
        <Bar dataKey="open" stackId="a" fill="#94a3b8" radius={[4, 0, 0, 4]} />
        <Bar dataKey="invoiceSent" stackId="a" fill="#2563eb" />
        <Bar dataKey="completed" stackId="a" fill="#16a34a" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
