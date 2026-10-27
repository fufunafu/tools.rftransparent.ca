import { businessDayCallMetrics, type BusinessDayCallMetrics } from "@/lib/lead-business-day";
import type { Lead, LeadSource } from "@/lib/customer-service/leads";
import {
  calculateLeadFunnel,
  isLeadInCustomDateRange,
  isLeadIncludedInPerformance,
  type LeadFunnelMetrics,
  type LeadTrendPoint,
} from "@/lib/lead-analytics";
import { isCallablePhone } from "@/lib/call-metrics";
import {
  leadResponseTimeMs,
  medianLeadResponseTimeMs,
} from "@/lib/lead-response-times";

export type LeadPerformanceMetricKey =
  | "sameDayCallRate"
  | "callRate"
  | "quoteRate"
  | "conversionRate"
  | "medianCallMs"
  | "medianQuoteMs";

export type LeadPerformanceRateMetricKey = Extract<
  LeadPerformanceMetricKey,
  "sameDayCallRate" | "callRate" | "quoteRate" | "conversionRate"
>;

export interface LeadPerformanceTrendSourceMetrics extends LeadFunnelMetrics {
  sameDayCallRate: number | null;
  businessDayCalls: BusinessDayCallMetrics;
  medianCallMs: number | null;
  callResponseCount: number;
  medianQuoteMs: number | null;
  quoteResponseCount: number;
}

export interface LeadPerformanceTrendPoint {
  label: string;
  fullLabel: string;
  rangeStart: string;
  rangeEnd: string;
  website: LeadPerformanceTrendSourceMetrics;
  meta: LeadPerformanceTrendSourceMetrics;
  outreach: LeadPerformanceTrendSourceMetrics;
}

export interface LeadPerformanceRateTrendPoint {
  label: string;
  rangeStart: string;
  rangeEnd: string;
  website: { value: number | null; count: number; denominator: number };
  meta: { value: number | null; count: number; denominator: number };
  outreach: { value: number | null; count: number; denominator: number };
}

type PerformanceLead = Pick<
  Lead,
  | "source"
  | "submitted_at"
  | "call_status"
  | "phone"
  | "quote_number"
  | "quote_sent_at"
  | "first_quote_at"
  | "first_call_at"
  | "outcome"
  | "not_applicable_reason"
  | "raw_payload"
>;

function summarizeSource(
  leads: PerformanceLead[],
  source: LeadSource,
  now: number,
): LeadPerformanceTrendSourceMetrics {
  const sourceLeads = leads.filter((lead) => lead.source === source);
  const funnel = calculateLeadFunnel(sourceLeads);
  const included = sourceLeads.filter(isLeadIncludedInPerformance);
  const callTimes = included.map((lead) => (
    leadResponseTimeMs(lead.submitted_at, lead.first_call_at)
  ));
  const quoteTimes = included.map((lead) => leadResponseTimeMs(
    lead.submitted_at,
    lead.first_quote_at ?? lead.quote_sent_at,
  ));

  const businessDayCalls = businessDayCallMetrics(sourceLeads, now);
  return {
    ...funnel,
    businessDayCalls,
    sameDayCallRate: businessDayCalls.sameDayCallRate,
    medianCallMs: medianLeadResponseTimeMs(callTimes),
    callResponseCount: callTimes.filter((duration) => duration != null).length,
    medianQuoteMs: medianLeadResponseTimeMs(quoteTimes),
    quoteResponseCount: quoteTimes.filter((duration) => duration != null).length,
    callEligible: included.filter((lead) => (
      lead.call_status !== "not_called" || isCallablePhone(lead.phone)
    )).length,
  };
}

export function buildLeadPerformanceTrend(
  leads: PerformanceLead[],
  buckets: LeadTrendPoint[],
  now: number = Date.now(),
): LeadPerformanceTrendPoint[] {
  return buckets.map((bucket) => {
    const bucketLeads = leads.filter((lead) => isLeadInCustomDateRange(
      lead,
      bucket.rangeStart,
      bucket.rangeEnd,
    ));

    return {
      label: bucket.label,
      fullLabel: bucket.fullLabel,
      rangeStart: bucket.rangeStart,
      rangeEnd: bucket.rangeEnd,
      website: summarizeSource(bucketLeads, "website", now),
      meta: summarizeSource(bucketLeads, "meta", now),
      outreach: summarizeSource(bucketLeads, "outreach", now),
    };
  });
}

function rateCounts(
  source: LeadPerformanceTrendSourceMetrics,
  metric: LeadPerformanceRateMetricKey,
): { count: number; denominator: number } {
  if (metric === "sameDayCallRate") return { count: source.businessDayCalls.dueOnTime, denominator: source.businessDayCalls.due };
  if (metric === "callRate") {
    return { count: source.attempted, denominator: source.callEligible };
  }
  if (metric === "quoteRate") {
    return { count: source.quoted, denominator: source.total };
  }
  return { count: source.won, denominator: source.total };
}

export function buildRollingLeadPerformanceRateTrend(
  points: LeadPerformanceTrendPoint[],
  metric: LeadPerformanceRateMetricKey,
  windowSize: number,
): LeadPerformanceRateTrendPoint[] {
  const size = Math.min(points.length || 1, Math.max(1, Math.floor(windowSize)));

  return points.map((point, index) => {
    const startIndex = Math.max(0, index - size + 1);
    const window = points.slice(startIndex, index + 1);
    const summarize = (source: LeadSource) => {
      const totals = window.reduce((result, current) => {
        const counts = rateCounts(current[source], metric);
        return {
          count: result.count + counts.count,
          denominator: result.denominator + counts.denominator,
        };
      }, { count: 0, denominator: 0 });

      return {
        ...totals,
        value: totals.denominator > 0
          ? Math.round((totals.count / totals.denominator) * 1000) / 10
          : null,
      };
    };

    return {
      label: point.label,
      rangeStart: points[startIndex]?.rangeStart ?? point.rangeStart,
      rangeEnd: point.rangeEnd,
      website: summarize("website"),
      meta: summarize("meta"),
      outreach: summarize("outreach"),
    };
  });
}
