"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  LeadPerformanceMetricKey,
  LeadPerformanceTrendPoint,
  LeadPerformanceTrendSourceMetrics,
} from "@/lib/lead-performance-trends";
import { formatLeadResponseTime } from "@/lib/lead-response-times";

const RATE_METRICS = new Set<LeadPerformanceMetricKey>([
  "callRate",
  "quoteRate",
  "conversionRate",
]);

function metricValue(
  source: LeadPerformanceTrendSourceMetrics,
  metric: LeadPerformanceMetricKey,
): number | null {
  if (metric === "callRate") return source.callEligible > 0 ? source.callRate : null;
  if (metric === "quoteRate") return source.total > 0 ? source.quoteRate : null;
  if (metric === "conversionRate") return source.total > 0 ? source.conversionRate : null;
  return source[metric];
}

function formatMetricValue(metric: LeadPerformanceMetricKey, value: number | null): string {
  if (value == null) return "No data";
  return RATE_METRICS.has(metric) ? `${value}%` : formatLeadResponseTime(value);
}

export default function LeadPerformanceTrendChart({
  data,
  metric,
  showWebsite,
  showMeta,
}: {
  data: LeadPerformanceTrendPoint[];
  metric: LeadPerformanceMetricKey;
  showWebsite: boolean;
  showMeta: boolean;
}) {
  const rateMetric = RATE_METRICS.has(metric);
  const chartData = data.map((point) => ({
    label: point.label,
    fullLabel: point.fullLabel,
    website: metricValue(point.website, metric),
    meta: metricValue(point.meta, metric),
  }));
  const hasData = chartData.some((point) => (
    (showWebsite && point.website != null) || (showMeta && point.meta != null)
  ));

  if (!hasData) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg bg-sand-50 text-center text-sm text-sand-500">
        No completed data is available for this metric in the selected period.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 12, right: 18, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          minTickGap={26}
          tick={{ fill: "#64748b", fontSize: 11 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={rateMetric ? 44 : 66}
          domain={rateMetric ? [0, 100] : [0, "auto"]}
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickFormatter={(value: number) => formatMetricValue(metric, value)}
        />
        <Tooltip
          labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
          formatter={(value: unknown, name: unknown) => [
            formatMetricValue(metric, typeof value === "number" ? value : null),
            String(name),
          ]}
          contentStyle={{
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.10)",
            fontSize: 12,
          }}
        />
        {showWebsite && (
          <Line
            type="monotone"
            dataKey="website"
            name="Website"
            stroke="#2563eb"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#2563eb", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        )}
        {showMeta && (
          <Line
            type="monotone"
            dataKey="meta"
            name="Meta"
            stroke="#db2777"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#db2777", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
