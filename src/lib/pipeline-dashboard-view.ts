export type PipelineView = "overview" | "forecast" | "team";

export interface PipelineHealthMetrics {
  conversionRate: number;
  avgCycleTimeDays: number;
  pipelineValue: number;
  invoiceSentDrafts: number;
  openDrafts: number;
  completedDrafts: number;
  totalDrafts: number;
  avgSaleValue: number;
}

export interface PipelineRepSummary {
  repName: string;
  conversionRate: number;
  pipelineValue: number;
  wonRevenue: number;
}

export interface PipelineForecastSummary {
  monthlyForecasts: Array<{ isFallback: boolean }>;
  seasonalPattern: Array<{ revenue: number }>;
}

export interface PipelineAttentionItem {
  id: "low-conversion" | "slow-cycle" | "no-conversions" | "unpaid-invoices";
  title: string;
  detail: string;
  severity: "high" | "medium";
}

export function parsePipelineView(value: unknown): PipelineView {
  return value === "forecast" || value === "team" ? value : "overview";
}

export function getPipelineAttentionItems(
  metrics: PipelineHealthMetrics,
): PipelineAttentionItem[] {
  const items: PipelineAttentionItem[] = [];

  if (metrics.openDrafts > 0 && metrics.completedDrafts === 0) {
    items.push({
      id: "no-conversions",
      title: "Open quotes are not converting",
      detail: `${metrics.openDrafts} open quotes and no completed sales in this period. Prioritize the oldest follow-ups.`,
      severity: "high",
    });
  }
  if (metrics.conversionRate < 30 && metrics.totalDrafts > 5) {
    items.push({
      id: "low-conversion",
      title: "Conversion needs attention",
      detail: `Only ${metrics.conversionRate}% of quotes converted. Review lost quotes and follow-up timing.`,
      severity: "high",
    });
  }
  if (metrics.invoiceSentDrafts > 3) {
    items.push({
      id: "unpaid-invoices",
      title: "Invoices are waiting for payment",
      detail: `${metrics.invoiceSentDrafts} invoiced quotes remain unpaid, representing active collection opportunities.`,
      severity: "medium",
    });
  }
  if (metrics.avgCycleTimeDays > 14) {
    items.push({
      id: "slow-cycle",
      title: "Deals are taking longer to close",
      detail: `The average sales cycle is ${metrics.avgCycleTimeDays} days. Follow up earlier on aging quotes.`,
      severity: "medium",
    });
  }

  return items.slice(0, 3);
}

export function getPipelinePositiveSummary(metrics: PipelineHealthMetrics): string {
  if (metrics.conversionRate >= 50) {
    return `${metrics.conversionRate}% of quotes converted, with ${metrics.pipelineValue > 0 ? "additional value still pending" : "no invoiced value left pending"}.`;
  }
  if (metrics.avgCycleTimeDays > 0 && metrics.avgCycleTimeDays <= 7) {
    return `Deals close in ${metrics.avgCycleTimeDays} days on average, indicating a fast sales cycle.`;
  }
  if (metrics.completedDrafts > 0) {
    return `${metrics.completedDrafts} quotes converted at an average sale value of $${Math.round(metrics.avgSaleValue).toLocaleString("en-US")}.`;
  }
  return `${metrics.totalDrafts} quotes were created in the selected period.`;
}

export function getPipelineTeamHighlights(reps: PipelineRepSummary[]) {
  const withSales = reps.filter((rep) => rep.wonRevenue > 0);
  const strongestRep = [...withSales].sort((a, b) => b.wonRevenue - a.wonRevenue)[0] ?? null;
  const bestConverter = [...reps]
    .filter((rep) => rep.conversionRate > 0)
    .sort((a, b) => b.conversionRate - a.conversionRate)[0] ?? null;
  const largestPipeline = [...reps]
    .filter((rep) => rep.pipelineValue > 0)
    .sort((a, b) => b.pipelineValue - a.pipelineValue)[0] ?? null;

  return { strongestRep, bestConverter, largestPipeline };
}

export function getPipelineManagementSummary(
  reps: PipelineRepSummary[],
  quoteAttributedRevenue: number,
) {
  return {
    ...getPipelineTeamHighlights(reps),
    quoteAttributedRevenue,
  };
}

export function getForecastConfidence(summary: PipelineForecastSummary): {
  level: "High" | "Moderate" | "Limited";
  detail: string;
} {
  const forecastMonths = summary.monthlyForecasts.length;
  const fallbackMonths = summary.monthlyForecasts.filter((month) => month.isFallback).length;
  const historicalMonths = summary.seasonalPattern.filter((month) => month.revenue > 0).length;

  if (forecastMonths === 0) {
    return {
      level: "Limited",
      detail: "No monthly forecast is available for the selected period.",
    };
  }
  if (historicalMonths >= 10 && fallbackMonths <= 2) {
    return {
      level: "High",
      detail: "Most projections are supported by a broad seasonal history.",
    };
  }
  if (historicalMonths >= 4 && fallbackMonths <= 6) {
    return {
      level: "Moderate",
      detail: `${fallbackMonths} of ${forecastMonths} months use fallback growth assumptions.`,
    };
  }
  return {
    level: "Limited",
    detail: `${fallbackMonths} of ${forecastMonths} months use fallback growth assumptions and history is sparse.`,
  };
}

export type PipelineDisplayState =
  | "loading"
  | "error"
  | "empty"
  | "partial"
  | "ready"
  | "cached"
  | "refreshing"
  | "stale";

export function getPipelineDisplayState({
  hasData,
  isEmpty,
  isPartial,
  loading,
  refreshing,
  error,
  cachedAt,
}: {
  hasData: boolean;
  isEmpty: boolean;
  isPartial: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string;
  cachedAt?: string;
}): PipelineDisplayState {
  if (!hasData) {
    if (error) return "error";
    return loading ? "loading" : "empty";
  }
  if (refreshing) return "refreshing";
  if (error) return "stale";
  if (isPartial) return "partial";
  if (isEmpty) return "empty";
  if (cachedAt) return "cached";
  return "ready";
}

export const PIPELINE_CONTENT_OWNERSHIP = {
  overview: [
    "pipeline-flow",
    "conversion-rate",
    "average-cycle-time",
    "average-sale",
    "value-win-rate",
    "needs-attention",
    "monthly-pipeline-trend",
    "pipeline-condition",
    "channel-snapshot",
  ],
  forecast: [
    "annual-forecast",
    "weighted-pipeline",
    "starting-revenue",
    "forecast-confidence",
    "monthly-forecast",
    "pipeline-aging",
    "seasonal-history",
    "forecast-assumptions",
  ],
  team: [
    "strongest-rep",
    "highest-conversion",
    "largest-open-pipeline",
    "quote-attributed-revenue",
    "rep-leaderboard",
    "quote-revenue-by-employee",
  ],
} as const satisfies Record<PipelineView, readonly string[]>;
