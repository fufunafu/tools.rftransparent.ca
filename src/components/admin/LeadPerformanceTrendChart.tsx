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
  LeadPerformanceRateMetricKey,
  LeadPerformanceTrendPoint,
  LeadPerformanceTrendSourceMetrics,
} from "@/lib/lead-performance-trends";
import { buildRollingLeadPerformanceRateTrend } from "@/lib/lead-performance-trends";
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

function isRateMetric(metric: LeadPerformanceMetricKey): metric is LeadPerformanceRateMetricKey {
  return RATE_METRICS.has(metric);
}

function formatRangeDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface MetricChartPoint {
  label: string;
  rangeStart: string;
  rangeEnd: string;
  fullLabel: string;
  website: number | null;
  meta: number | null;
  websiteCount: number;
  websiteDenominator: number;
  metaCount: number;
  metaDenominator: number;
}

function MetricTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    name?: string | number;
    payload?: MetricChartPoint;
  }>;
  metric: LeadPerformanceMetricKey;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="min-w-[210px] rounded-lg border border-sand-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-sand-700">{point.fullLabel}</p>
      {payload?.map((entry) => {
        const source = entry.dataKey === "meta" ? "meta" : "website";
        const count = source === "website" ? point.websiteCount : point.metaCount;
        const denominator = source === "website"
          ? point.websiteDenominator
          : point.metaDenominator;
        return (
          <div key={source} className="flex items-start justify-between gap-5 py-0.5">
            <span className="flex items-center gap-1.5 text-sand-500">
              <span className={`h-2 w-2 rounded-sm ${source === "website" ? "bg-blue-600" : "bg-pink-600"}`} />
              {entry.name}
            </span>
            <span className="text-right">
              <span className="block font-semibold text-sand-900">
                {formatMetricValue(metric, point[source])}
              </span>
              <span className="text-[10px] text-sand-400">
                {count} of {denominator} {isRateMetric(metric) ? "leads" : "completed"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function LeadPerformanceTrendChart({
  data,
  metric,
  showWebsite,
  showMeta,
  rollingWindowSize,
}: {
  data: LeadPerformanceTrendPoint[];
  metric: LeadPerformanceMetricKey;
  showWebsite: boolean;
  showMeta: boolean;
  rollingWindowSize: number;
}) {
  const rateMetric = isRateMetric(metric);
  const chartData: MetricChartPoint[] = rateMetric
    ? buildRollingLeadPerformanceRateTrend(data, metric, rollingWindowSize).map((point) => ({
        label: point.label,
        rangeStart: point.rangeStart,
        rangeEnd: point.rangeEnd,
        fullLabel: point.rangeStart === point.rangeEnd
          ? formatRangeDate(point.rangeEnd)
          : `${formatRangeDate(point.rangeStart)} to ${formatRangeDate(point.rangeEnd)}`,
        website: point.website.value,
        meta: point.meta.value,
        websiteCount: point.website.count,
        websiteDenominator: point.website.denominator,
        metaCount: point.meta.count,
        metaDenominator: point.meta.denominator,
      }))
    : data.map((point) => ({
        label: point.label,
        rangeStart: point.rangeStart,
        rangeEnd: point.rangeEnd,
        fullLabel: point.fullLabel,
        website: metricValue(point.website, metric),
        meta: metricValue(point.meta, metric),
        websiteCount: metric === "medianCallMs"
          ? point.website.callResponseCount
          : point.website.quoteResponseCount,
        websiteDenominator: metric === "medianCallMs"
          ? point.website.callEligible
          : point.website.total,
        metaCount: metric === "medianCallMs"
          ? point.meta.callResponseCount
          : point.meta.quoteResponseCount,
        metaDenominator: metric === "medianCallMs"
          ? point.meta.callEligible
          : point.meta.total,
      }));
  const hasData = chartData.some((point) => (
    (showWebsite && point.website != null) || (showMeta && point.meta != null)
  ));
  const labelsByDate = new Map(chartData.map((point) => [point.rangeEnd, point.label]));

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
          dataKey="rangeEnd"
          axisLine={false}
          tickLine={false}
          minTickGap={26}
          tick={{ fill: "#64748b", fontSize: 11 }}
          tickFormatter={(value: string) => labelsByDate.get(value) ?? ""}
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
          content={<MetricTooltip metric={metric} />}
          cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
        />
        {showWebsite && (
          <Line
            type="monotone"
            dataKey="website"
            name="Website"
            stroke="#2563eb"
            strokeWidth={2.5}
            dot={chartData.length <= 14 ? { r: 3, fill: "#2563eb", strokeWidth: 0 } : false}
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
            dot={chartData.length <= 14 ? { r: 3, fill: "#db2777", strokeWidth: 0 } : false}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
