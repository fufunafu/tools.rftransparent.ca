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
// Each export is a whole chart block (ResponsiveContainer outward) — never
// wrap individual recharts children in dynamic(), chart containers introspect
// their child component types.

// ─── Types (mirror PipelineDashboard) ───────────────────────────────────────

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

// ─── Formatters (duplicated from PipelineDashboard — importing them from the
// parent would statically link the two modules and defeat the code split) ───

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

// ─── Chart blocks ───────────────────────────────────────────────────────────

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

/** Month-by-month revenue forecast bars (forecast + from-pipeline portion). */
export function ForecastChart({ data }: { data: MonthlyForecast[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data}>
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
  );
}

/** Historical seasonal pattern: monthly revenue bars + clamped MoM growth line. */
export function SeasonalPatternChart({ data }: { data: SeasonalChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
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
  );
}

/** Monthly trend: won revenue + pipeline value areas with conversion rate line. */
export function MonthlyTrendChart({ data }: { data: MonthlyTrend[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
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
        <Bar dataKey="open" stackId="a" fill="#f59e0b" radius={[4, 0, 0, 4]} />
        <Bar dataKey="invoiceSent" stackId="a" fill="#3b82f6" />
        <Bar dataKey="completed" stackId="a" fill="#16a34a" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
