"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { Lead, LeadSource } from "@/lib/customer-service/leads";
import {
  buildCustomLeadTrend,
  buildLeadTrend,
  calculateLeadFunnel,
  calculateLeadFunnelBySource,
  isLeadInCustomDateRange,
  isLeadIncludedInPerformance,
  leadTrendQueryBounds,
  type LeadTrendQueryBounds,
  type LeadTrendRange,
} from "@/lib/lead-analytics";
import {
  buildLeadPerformanceTrend,
  type LeadPerformanceMetricKey,
  type LeadPerformanceTrendPoint,
} from "@/lib/lead-performance-trends";
import {
  formatLeadResponseTime,
  leadResponseTimeMs,
  medianLeadResponseTimeMs,
} from "@/lib/lead-response-times";
import { redirectOnUnauthorized } from "@/lib/client-auth";

const LeadTrendChart = dynamic(() => import("@/components/admin/LeadTrendChart"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-lg bg-sand-50" />,
});

const LeadPerformanceTrendChart = dynamic(
  () => import("@/components/admin/LeadPerformanceTrendChart"),
  {
    ssr: false,
    loading: () => <div className="h-full animate-pulse rounded-lg bg-sand-50" />,
  },
);

type TrendSelection = LeadTrendRange | "custom";

const TREND_RANGES: Array<{ value: TrendSelection; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const PERFORMANCE_CHARTS: Array<{
  metric: LeadPerformanceMetricKey;
  title: string;
  description: string;
}> = [
  {
    metric: "callRate",
    title: "Call attempt rate",
    description: "Share of callable leads with at least one call attempt. Higher is better.",
  },
  {
    metric: "quoteRate",
    title: "Quote rate",
    description: "Share of included leads that received a quote. Higher is better.",
  },
  {
    metric: "conversionRate",
    title: "Lead-to-order rate",
    description: "Share of included leads that became an order. Higher is better.",
  },
  {
    metric: "medianCallMs",
    title: "Median elapsed time to call",
    description: "Median elapsed time among leads with a recorded first call. Lower is better.",
  },
  {
    metric: "medianQuoteMs",
    title: "Median elapsed time to quote",
    description: "Median elapsed time among leads with a recorded first quote. Lower is better.",
  },
];

async function fetcher<T>(url: string): Promise<T> {
  const response = redirectOnUnauthorized(await fetch(url));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body as T;
}

function leadListUrl(bounds: LeadTrendQueryBounds | null): string | null {
  if (!bounds) return null;
  const params = new URLSearchParams({ to: bounds.to });
  if (bounds.from) params.set("from", bounds.from);
  return `/api/customer-service/leads?${params.toString()}`;
}

function leadResponsePerformanceUrl(bounds: LeadTrendQueryBounds | null): string | null {
  if (!bounds) return null;
  const params = new URLSearchParams({ view: "response_performance", to: bounds.to });
  if (bounds.from) params.set("from", bounds.from);
  return `/api/customer-service/leads?${params.toString()}`;
}

function torontoDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ""
  );
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function defaultCustomDates(now: Date): { from: string; to: string } {
  return {
    from: torontoDateKey(new Date(now.getTime() - 29 * 86_400_000)),
    to: torontoDateKey(now),
  };
}

function formatDateKey(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatSelectedPeriod(
  points: Array<{ rangeStart: string; rangeEnd: string }>,
): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "No selected period";
  return first.rangeStart === last.rangeEnd
    ? formatDateKey(first.rangeStart)
    : `${formatDateKey(first.rangeStart)} to ${formatDateKey(last.rangeEnd)}`;
}

function performanceRateWindow(
  range: TrendSelection,
  customFrom: string,
  customTo: string,
): { size: number; label: string } {
  if (range === "7d") return { size: 3, label: "3-day rolling" };
  if (range === "30d") return { size: 7, label: "7-day rolling" };
  if (range === "90d") return { size: 4, label: "4-week rolling" };
  if (range === "12m" || range === "all") return { size: 3, label: "3-month rolling" };

  const start = Date.parse(`${customFrom}T00:00:00.000Z`);
  const end = Date.parse(`${customTo}T00:00:00.000Z`);
  const spanDays = Number.isFinite(start) && Number.isFinite(end)
    ? Math.floor(Math.abs(end - start) / 86_400_000) + 1
    : 30;
  if (spanDays > 180) return { size: 3, label: "3-month rolling" };
  if (spanDays > 45) return { size: 4, label: "4-week rolling" };
  if (spanDays >= 14) return { size: 7, label: "7-day rolling" };
  if (spanDays >= 5) return { size: 3, label: "3-day rolling" };
  return { size: 1, label: "Daily cohort" };
}

interface SourceResponseSummary {
  medianCallMs: number | null;
  callCount: number;
  medianQuoteMs: number | null;
  quoteCount: number;
}

function responseSummary(leads: Lead[], source?: LeadSource): SourceResponseSummary {
  const included = leads.filter((lead) => (
    (!source || lead.source === source) && isLeadIncludedInPerformance(lead)
  ));
  const callTimes = included.map((lead) => (
    leadResponseTimeMs(lead.submitted_at, lead.first_call_at)
  ));
  const quoteTimes = included.map((lead) => leadResponseTimeMs(
    lead.submitted_at,
    lead.first_quote_at ?? lead.quote_sent_at,
  ));
  return {
    medianCallMs: medianLeadResponseTimeMs(callTimes),
    callCount: callTimes.filter((duration) => duration != null).length,
    medianQuoteMs: medianLeadResponseTimeMs(quoteTimes),
    quoteCount: quoteTimes.filter((duration) => duration != null).length,
  };
}

function SourceToggle({
  source,
  checked,
  disabled,
  onChange,
}: {
  source: LeadSource;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const website = source === "website";
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-sand-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className={`h-4 w-4 ${website ? "accent-blue-600" : "accent-pink-600"}`}
      />
      <span className={`h-2.5 w-2.5 rounded-sm ${website ? "bg-blue-600" : "bg-pink-600"}`} />
      {website ? "Website" : "Meta"}
    </label>
  );
}

function SnapshotCard({
  label,
  value,
  detail,
  website,
  meta,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  website: string | number;
  meta: string | number;
  tone: string;
}) {
  return (
    <article className="rounded-xl border border-sand-200 bg-white p-4 shadow-sm shadow-slate-200/30">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-sand-500">{label}</h3>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-sand-900">{value}</p>
      <p className="mt-1 min-h-8 text-xs leading-4 text-sand-500">{detail}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-sand-100 pt-3 text-xs">
        <div>
          <p className="flex items-center gap-1.5 text-sand-500">
            <span className="h-2 w-2 rounded-sm bg-blue-600" />Website
          </p>
          <p className="mt-1 font-semibold text-sand-800">{website}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-sand-500">
            <span className="h-2 w-2 rounded-sm bg-pink-600" />Meta
          </p>
          <p className="mt-1 font-semibold text-sand-800">{meta}</p>
        </div>
      </div>
    </article>
  );
}

function metricDisplay(
  metric: LeadPerformanceMetricKey,
  source: LeadPerformanceTrendPoint["website"],
): string {
  if (metric === "callRate") return `${source.callRate}%`;
  if (metric === "quoteRate") return `${source.quoteRate}%`;
  if (metric === "conversionRate") return `${source.conversionRate}%`;
  return formatLeadResponseTime(source[metric]);
}

function MetricChartCard({
  metric,
  title,
  description,
  data,
  showWebsite,
  showMeta,
  rollingWindow,
  summary,
  loading = false,
  error = null,
}: {
  metric: LeadPerformanceMetricKey;
  title: string;
  description: string;
  data: LeadPerformanceTrendPoint[];
  showWebsite: boolean;
  showMeta: boolean;
  rollingWindow: { size: number; label: string };
  summary: LeadPerformanceTrendPoint | null;
  loading?: boolean;
  error?: string | null;
}) {
  const rateMetric = metric === "callRate" || metric === "quoteRate" || metric === "conversionRate";
  return (
    <article className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm shadow-slate-200/30">
      <header className="flex flex-col gap-3 border-b border-sand-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-sand-900">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-sand-500">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {summary && (
            <>
              <span className="font-semibold text-blue-700">{metricDisplay(metric, summary.website)}</span>
              <span className="font-semibold text-pink-700">{metricDisplay(metric, summary.meta)}</span>
            </>
          )}
          <span className="rounded-full bg-sand-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-sand-500">
            {rateMetric ? rollingWindow.label : "Cohort median"}
          </span>
        </div>
      </header>
      <div className="h-64 px-2 pb-3 pt-4 sm:h-72 sm:px-4">
        {loading ? (
          <div className="h-full animate-pulse rounded-lg bg-sand-50" role="status" aria-label={`Loading ${title}`} />
        ) : error ? (
          <div className="flex h-full items-center justify-center rounded-lg bg-red-50 px-5 text-center text-sm text-red-700">
            {title} could not be loaded: {error}
          </div>
        ) : (
          <LeadPerformanceTrendChart
            data={data}
            metric={metric}
            showWebsite={showWebsite}
            showMeta={showMeta}
            rollingWindowSize={rollingWindow.size}
          />
        )}
      </div>
    </article>
  );
}

export default function LeadAnalysisDashboard({
  initialLeads,
  initialNow,
  initialBounds,
}: {
  initialLeads?: Lead[] | null;
  initialNow: number;
  initialBounds: LeadTrendQueryBounds | null;
}) {
  const now = useMemo(() => new Date(initialNow), [initialNow]);
  const [trendRange, setTrendRange] = useState<TrendSelection>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sources, setSources] = useState<Record<LeadSource, boolean>>({
    website: true,
    meta: true,
  });
  const requestedBounds = useMemo(
    () => leadTrendQueryBounds(trendRange, now, customFrom, customTo),
    [trendRange, now, customFrom, customTo],
  );
  const leadsUrl = leadListUrl(requestedBounds);
  const initialLeadsUrl = leadListUrl(initialBounds);
  const { data, error, isLoading } = useSWR<{ leads: Lead[] }>(leadsUrl, fetcher, {
    fallbackData: initialLeads && leadsUrl === initialLeadsUrl
      ? { leads: initialLeads }
      : undefined,
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  const {
    data: responsePerformanceData,
    error: responsePerformanceError,
    isLoading: responsePerformanceLoading,
  } = useSWR<{ leads: Lead[]; tracking_started_at: string | null }>(
    leadResponsePerformanceUrl(requestedBounds),
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  const leads = useMemo(() => data?.leads ?? [], [data?.leads]);
  const responsePerformanceLeads = useMemo(
    () => responsePerformanceData?.leads ?? [],
    [responsePerformanceData?.leads],
  );
  const trend = useMemo(
    () => trendRange === "custom"
      ? buildCustomLeadTrend(leads, customFrom, customTo, now)
      : buildLeadTrend(leads, trendRange, now),
    [leads, trendRange, customFrom, customTo, now],
  );
  const analysisLeads = useMemo(() => {
    const first = trend.points[0];
    const last = trend.points.at(-1);
    if (!first || !last) return [];
    return leads.filter((lead) => isLeadInCustomDateRange(
      lead,
      first.rangeStart,
      last.rangeEnd,
    ));
  }, [leads, trend.points]);
  const funnel = useMemo(() => calculateLeadFunnel(analysisLeads), [analysisLeads]);
  const funnelBySource = useMemo(
    () => calculateLeadFunnelBySource(analysisLeads),
    [analysisLeads],
  );
  const quoteResponses = useMemo(() => responseSummary(analysisLeads), [analysisLeads]);
  const quoteResponsesBySource = useMemo(() => ({
    website: responseSummary(analysisLeads, "website"),
    meta: responseSummary(analysisLeads, "meta"),
  }), [analysisLeads]);
  const responseAnalysisLeads = useMemo(() => {
    const first = trend.points[0];
    const last = trend.points.at(-1);
    if (!first || !last) return [];
    return responsePerformanceLeads.filter((lead) => isLeadInCustomDateRange(
      lead,
      first.rangeStart,
      last.rangeEnd,
    ));
  }, [responsePerformanceLeads, trend.points]);
  const callResponses = useMemo(
    () => responseSummary(responseAnalysisLeads),
    [responseAnalysisLeads],
  );
  const callResponsesBySource = useMemo(() => ({
    website: responseSummary(responseAnalysisLeads, "website"),
    meta: responseSummary(responseAnalysisLeads, "meta"),
  }), [responseAnalysisLeads]);
  const performanceTrend = useMemo(
    () => buildLeadPerformanceTrend(leads, trend.points),
    [leads, trend.points],
  );
  const callPerformanceTrend = useMemo(
    () => buildLeadPerformanceTrend(responsePerformanceLeads, trend.points),
    [responsePerformanceLeads, trend.points],
  );
  const trendPoints = trend.points;
  const trendCurrent = trend.current;
  const summaryPoint = useMemo<LeadPerformanceTrendPoint | null>(() => {
    const first = trendPoints[0];
    const last = trendPoints.at(-1);
    if (!first || !last) return null;
    return buildLeadPerformanceTrend(leads, [{
      label: "Selected period",
      fullLabel: formatSelectedPeriod(trendPoints),
      rangeStart: first.rangeStart,
      rangeEnd: last.rangeEnd,
      website: trendCurrent.website,
      meta: trendCurrent.meta,
      total: trendCurrent.total,
    }])[0] ?? null;
  }, [leads, trendCurrent, trendPoints]);
  const callSummaryPoint = useMemo<LeadPerformanceTrendPoint | null>(() => {
    const first = trendPoints[0];
    const last = trendPoints.at(-1);
    if (!first || !last) return null;
    return buildLeadPerformanceTrend(responsePerformanceLeads, [{
      label: "Selected period",
      fullLabel: formatSelectedPeriod(trendPoints),
      rangeStart: first.rangeStart,
      rangeEnd: last.rangeEnd,
      website: 0,
      meta: 0,
      total: 0,
    }])[0] ?? null;
  }, [responsePerformanceLeads, trendPoints]);
  const rollingWindow = performanceRateWindow(trendRange, customFrom, customTo);
  const excluded = analysisLeads.length - funnel.total;
  const toggleSource = (source: LeadSource) => {
    const other = source === "website" ? "meta" : "website";
    setSources((current) => {
      if (current[source] && !current[other]) return current;
      return { ...current, [source]: !current[source] };
    });
  };
  const selectRange = (range: TrendSelection) => {
    if (range === "custom" && (!customFrom || !customTo)) {
      const defaults = defaultCustomDates(now);
      setCustomFrom(defaults.from);
      setCustomTo(defaults.to);
    }
    setTrendRange(range);
  };
  const selectChartRange = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setTrendRange("custom");
  };

  return (
    <div className="mx-auto max-w-[1900px] space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Lead intelligence</p>
          <h1 className="mt-1 text-2xl font-bold text-sand-900">Lead analysis</h1>
          <p className="mt-1 text-sm text-sand-500">
            Understand lead volume, conversion, and response performance over time.
          </p>
        </div>
        <Link
          href="/customer-service/leads"
          className="inline-flex self-start items-center gap-2 rounded-md border border-sand-300 bg-white px-3 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
        >
          <span aria-hidden="true">←</span>
          Back to leads
        </Link>
      </header>

      <section className="rounded-xl border border-sand-200 bg-white p-3 shadow-sm shadow-slate-200/30 sm:p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="inline-flex max-w-full flex-nowrap self-start overflow-x-auto rounded-lg border border-sand-200 bg-sand-50 p-1 text-xs font-medium">
            {TREND_RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                aria-pressed={trendRange === range.value}
                onClick={() => selectRange(range.value)}
                className={`shrink-0 rounded-md px-3 py-1.5 transition-colors ${
                  trendRange === range.value
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-800"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <SourceToggle
              source="website"
              checked={sources.website}
              disabled={sources.website && !sources.meta}
              onChange={() => toggleSource("website")}
            />
            <SourceToggle
              source="meta"
              checked={sources.meta}
              disabled={sources.meta && !sources.website}
              onChange={() => toggleSource("meta")}
            />
            <span className="text-xs text-sand-400">{formatSelectedPeriod(trend.points)}</span>
          </div>
        </div>
        {trendRange === "custom" && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-sand-100 pt-4">
            <label className="text-xs font-medium text-sand-600">
              From
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="mt-1 block rounded-md border border-sand-200 bg-white px-3 py-2 text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </label>
            <label className="text-xs font-medium text-sand-600">
              To
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="mt-1 block rounded-md border border-sand-200 bg-white px-3 py-2 text-sm text-sand-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </label>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Lead analysis could not be loaded. {error.message}
        </p>
      )}

      {isLoading && !data ? (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-sand-200 bg-white" role="status">
          <div className="flex items-center gap-3 text-sm text-sand-600">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-sand-300 border-t-indigo-600" aria-hidden="true" />
            Loading lead analysis...
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="snapshot-heading">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="snapshot-heading" className="text-base font-semibold text-sand-900">Selected-period snapshot</h2>
                <p className="mt-0.5 text-xs text-sand-500">
                  {funnel.total} of {analysisLeads.length} leads are included in performance metrics
                  {excluded > 0 ? `; ${excluded} excluded` : ""}.
                </p>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-sand-400">
                Spam, forwarded, and unquotable leads are excluded from rates
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <SnapshotCard
                label="Lead volume"
                value={trend.current.total.toLocaleString()}
                detail="All consolidated leads first submitted in this period"
                website={trend.current.website.toLocaleString()}
                meta={trend.current.meta.toLocaleString()}
                tone="bg-indigo-500"
              />
              <SnapshotCard
                label="Call attempt rate"
                value={`${funnel.callRate}%`}
                detail={`${funnel.attempted} of ${funnel.callEligible} callable leads attempted`}
                website={`${funnelBySource.website.callRate}%`}
                meta={`${funnelBySource.meta.callRate}%`}
                tone="bg-amber-400"
              />
              <SnapshotCard
                label="Quote rate"
                value={`${funnel.quoteRate}%`}
                detail={`${funnel.quoted} of ${funnel.total} included leads quoted`}
                website={`${funnelBySource.website.quoteRate}%`}
                meta={`${funnelBySource.meta.quoteRate}%`}
                tone="bg-cyan-500"
              />
              <SnapshotCard
                label="Lead-to-order"
                value={`${funnel.conversionRate}%`}
                detail={`${funnel.won} of ${funnel.total} included leads became orders`}
                website={`${funnelBySource.website.conversionRate}%`}
                meta={`${funnelBySource.meta.conversionRate}%`}
                tone="bg-emerald-500"
              />
              <SnapshotCard
                label="Median time to call"
                value={responsePerformanceLoading ? "Loading..." : formatLeadResponseTime(callResponses.medianCallMs)}
                detail={responsePerformanceData?.tracking_started_at
                  ? `${callResponses.callCount} records since ${formatDateKey(responsePerformanceData.tracking_started_at.slice(0, 10))}`
                  : `${callResponses.callCount} completed first-call records`}
                website={formatLeadResponseTime(callResponsesBySource.website.medianCallMs)}
                meta={formatLeadResponseTime(callResponsesBySource.meta.medianCallMs)}
                tone="bg-blue-500"
              />
              <SnapshotCard
                label="Median time to quote"
                value={formatLeadResponseTime(quoteResponses.medianQuoteMs)}
                detail={`${quoteResponses.quoteCount} completed first-quote records`}
                website={formatLeadResponseTime(quoteResponsesBySource.website.medianQuoteMs)}
                meta={formatLeadResponseTime(quoteResponsesBySource.meta.medianQuoteMs)}
                tone="bg-pink-500"
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm shadow-slate-200/30">
            <header className="flex flex-col gap-2 border-b border-sand-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-sand-900">Lead volume by source</h2>
                <p className="mt-0.5 text-xs text-sand-500">
                  Consolidated website and Meta leads grouped by first submission date.
                </p>
              </div>
              <p className="text-xs font-medium text-sand-500">
                {trend.current.website.toLocaleString()} Website · {trend.current.meta.toLocaleString()} Meta
              </p>
            </header>
            <div className="h-72 px-3 pb-3 pt-4 sm:h-80 sm:px-5">
              <LeadTrendChart
                data={trend.points}
                showWebsite={sources.website}
                showMeta={sources.meta}
                onSelectRange={selectChartRange}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2" aria-label="Performance trends">
            {PERFORMANCE_CHARTS.map((chart) => (
              <MetricChartCard
                key={chart.metric}
                {...chart}
                data={chart.metric === "medianCallMs" ? callPerformanceTrend : performanceTrend}
                showWebsite={sources.website}
                showMeta={sources.meta}
                rollingWindow={rollingWindow}
                summary={chart.metric === "medianCallMs" ? callSummaryPoint : summaryPoint}
                loading={chart.metric === "medianCallMs" && responsePerformanceLoading}
                error={chart.metric === "medianCallMs" ? responsePerformanceError?.message ?? null : null}
              />
            ))}
          </section>

          <section className="rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-xs leading-5 text-sand-500">
            <p className="font-semibold text-sand-700">How to read these charts</p>
            <p className="mt-1">
              Rate charts use rolling windows to reduce noise from small daily samples. Response-time charts use
              completed first responses only and measure elapsed time, including nights and weekends. Recent lead
              cohorts can improve as calls, quotes, and orders are completed.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
