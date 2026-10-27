import { describe, expect, it } from "vitest";
import { buildCustomLeadTrend } from "@/lib/lead-analytics";
import {
  buildLeadPerformanceTrend,
  buildRollingQuoteTrend,
  buildRollingLeadPerformanceRateTrend,
} from "@/lib/lead-performance-trends";

type TrendLead = Parameters<typeof buildLeadPerformanceTrend>[0][number];

function lead(overrides: Partial<TrendLead> & Pick<TrendLead, "source" | "submitted_at">): TrendLead {
  const { source, submitted_at: submittedAt, ...rest } = overrides;
  return {
    source,
    submitted_at: submittedAt,
    call_status: "not_called",
    phone: "5145551234",
    quote_number: null,
    quote_sent_at: null,
    first_quote_at: null,
    first_call_at: null,
    outcome: "new",
    not_applicable_reason: null,
    raw_payload: {},
    ...rest,
  };
}

describe("buildLeadPerformanceTrend", () => {
  const buckets = buildCustomLeadTrend([], "2026-08-01", "2026-08-02").points;

  it("calculates funnel rates separately for each source and submission cohort", () => {
    const result = buildLeadPerformanceTrend([
      lead({
        source: "website",
        submitted_at: "2026-08-01T14:00:00.000Z",
        call_status: "called",
        quote_number: "D1",
        outcome: "won",
      }),
      lead({ source: "website", submitted_at: "2026-08-01T15:00:00.000Z" }),
      lead({
        source: "meta",
        submitted_at: "2026-08-02T15:00:00.000Z",
        call_status: "no_answer",
      }),
    ], buckets);

    expect(result[0].website).toMatchObject({
      total: 2,
      attempted: 1,
      quoted: 1,
      won: 1,
      callRate: 50,
      quoteRate: 50,
      conversionRate: 50,
    });
    expect(result[0].meta.total).toBe(0);
    expect(result[1].meta).toMatchObject({
      total: 1,
      attempted: 1,
      callRate: 100,
    });
  });

  it("calculates response medians and keeps completion counts", () => {
    const result = buildLeadPerformanceTrend([
      lead({
        source: "website",
        submitted_at: "2026-08-01T12:00:00.000Z",
        first_call_at: "2026-08-01T13:00:00.000Z",
      }),
      lead({
        source: "website",
        submitted_at: "2026-08-01T12:00:00.000Z",
        first_call_at: "2026-08-01T15:00:00.000Z",
      }),
    ], buckets);

    expect(result[0].website).toMatchObject({
      medianCallMs: 2 * 60 * 60 * 1000,
      callResponseCount: 2,
      callEligible: 2,
    });
    expect(result[1].website.medianCallMs).toBeNull();
    expect(result[1].meta.medianCallMs).toBeNull();
  });
});

describe("buildRollingLeadPerformanceRateTrend", () => {
  it("uses available early points, then recomputes the full rolling window from combined counts", () => {
    const buckets = buildCustomLeadTrend([], "2026-08-01", "2026-08-03").points;
    const leads = [
      lead({
        source: "website",
        submitted_at: "2026-08-01T14:00:00.000Z",
        call_status: "called",
      }),
      ...Array.from({ length: 9 }, (_, index) => lead({
        source: "website",
        submitted_at: `2026-08-02T${String(index + 10).padStart(2, "0")}:00:00.000Z`,
      })),
      lead({
        source: "website",
        submitted_at: "2026-08-03T14:00:00.000Z",
        call_status: "called",
      }),
      lead({
        source: "website",
        submitted_at: "2026-08-03T15:00:00.000Z",
        call_status: "called",
      }),
    ];
    const daily = buildLeadPerformanceTrend(leads, buckets);

    const result = buildRollingLeadPerformanceRateTrend(daily, "callRate", 2);

    expect(result[0].website).toEqual({ value: 100, count: 1, denominator: 1 });
    expect(result[0]).toMatchObject({
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-01",
    });
    expect(result[1].website).toEqual({ value: 10, count: 1, denominator: 10 });
    expect(result[1]).toMatchObject({
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-02",
    });
    expect(result[2].website).toEqual({ value: 18.2, count: 2, denominator: 11 });
    expect(result[2]).toMatchObject({
      rangeStart: "2026-08-02",
      rangeEnd: "2026-08-03",
    });
  });
});

it("weights same-business-day rates by passed deadlines, not pending leads or missing timing", () => {
  const buckets = buildCustomLeadTrend([], "2026-10-22", "2026-10-23").points;
  const rows = [
    lead({ source: "website", submitted_at: "2026-10-22T14:00:00Z", first_call_at: "2026-10-22T15:00:00Z" }),
    lead({ source: "website", submitted_at: "2026-10-22T14:00:00Z" }),
    lead({ source: "website", submitted_at: "2026-10-23T14:00:00Z" }),
    lead({ source: "website", submitted_at: "2026-10-23T22:00:00Z" }),
    lead({ source: "website", submitted_at: "2026-10-22T14:00:00Z", call_status: "called" }),
  ];
  const points = buildLeadPerformanceTrend(rows, buckets, Date.parse("2026-10-24T15:00:00Z"));
  const rolling = buildRollingLeadPerformanceRateTrend(points, "sameDayCallRate", 2);
  expect(rolling[1].website).toEqual({ value: 33.3, count: 1, denominator: 3 });
  expect(rolling[1].outreach.value).toBeNull();
});

it("pools quote durations across three calendar days rather than averaging daily medians", () => {
  const buckets = buildCustomLeadTrend([], "2026-10-01", "2026-10-05").points;
  const rows = [
    lead({ source: "website", submitted_at: "2026-10-01T12:00:00Z", first_quote_at: "2026-10-01T13:00:00Z" }),
    ...[2, 3, 4].map(hours => lead({ source: "website", submitted_at: "2026-10-02T12:00:00Z", first_quote_at: `2026-10-02T${12 + hours}:00:00Z` })),
    lead({ source: "meta", submitted_at: "2026-10-02T12:00:00Z", first_quote_at: "2026-10-03T12:00:00Z" }),
  ];
  const result = buildRollingQuoteTrend(rows, buckets, Date.now(), 3);
  expect(result[2].website.medianQuoteMs).toBe(2.5 * 3600000);
  expect(result[2].website.quoteResponseCount).toBe(4);
  expect(result[2].meta.medianQuoteMs).toBe(24 * 3600000);
  expect(result[3].website.medianQuoteMs).toBe(3 * 3600000);
  expect(result[4].website.medianQuoteMs).toBeNull();
  expect(result[2]).toMatchObject({ rangeStart: "2026-10-01", rangeEnd: "2026-10-03" });
});
it("uses calendar-day windows even when the other charts have weekly buckets", () => {
  const buckets = buildCustomLeadTrend([], "2026-07-01", "2026-09-28").points;
  const result = buildRollingQuoteTrend([], buckets, Date.now(), 3);
  expect(result).toHaveLength(90);
  expect(result[30]).toMatchObject({ rangeStart: "2026-07-29", rangeEnd: "2026-07-31" });
});


it("defaults quote medians to seven calendar days and expires the oldest cohort on day eight", () => {
  const buckets = buildCustomLeadTrend([], "2026-10-01", "2026-10-08").points;
  const rows = [lead({ source: "website", submitted_at: "2026-10-01T12:00:00Z", first_quote_at: "2026-10-01T14:00:00Z" })];
  const result = buildRollingQuoteTrend(rows, buckets);
  expect(result[6].website.medianQuoteMs).toBe(7200000);
  expect(result[6].rangeStart).toBe("2026-10-01");
  expect(result[7].website.medianQuoteMs).toBeNull();
  expect(result[7].rangeStart).toBe("2026-10-02");
});

it("counts only quoted wins and weights conversion by quoted leads", () => {
  const buckets = buildCustomLeadTrend([], "2026-10-01", "2026-10-02").points;
  const base = { source: "website" as const, submitted_at: "2026-10-01T12:00:00Z" };
  const rows = [
    lead({ ...base, quote_number: "D1", outcome: "won" }),
    lead({ ...base, outcome: "won", quote_number: null }),
    lead({ ...base, quote_number: "D2", outcome: "not_applicable" }),
    ...Array.from({ length: 3 }, () => lead({ ...base, submitted_at: "2026-10-02T12:00:00Z", quote_number: "D3", outcome: "quoted" })),
  ];
  const result = buildRollingLeadPerformanceRateTrend(buildLeadPerformanceTrend(rows, buckets), "quoteConversionRate", 2);
  expect(result[0].website).toEqual({ count: 1, denominator: 1, value: 100 });
  expect(result[1].website).toEqual({ count: 1, denominator: 4, value: 25 });
  expect(result[1].meta).toEqual({ count: 0, denominator: 0, value: null });
});
