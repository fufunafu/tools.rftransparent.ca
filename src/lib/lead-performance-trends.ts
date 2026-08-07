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
  | "callRate"
  | "quoteRate"
  | "conversionRate"
  | "medianCallMs"
  | "medianQuoteMs";

export interface LeadPerformanceTrendSourceMetrics extends LeadFunnelMetrics {
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

  return {
    ...funnel,
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
      website: summarizeSource(bucketLeads, "website"),
      meta: summarizeSource(bucketLeads, "meta"),
    };
  });
}
