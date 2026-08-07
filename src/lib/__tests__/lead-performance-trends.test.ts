import { describe, expect, it } from "vitest";
import { buildCustomLeadTrend } from "@/lib/lead-analytics";
import {
  buildLeadPerformanceTrend,
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
  it("recomputes a rolling rate from combined counts instead of averaging percentages", () => {
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

    expect(result[0].website.value).toBeNull();
    expect(result[1].website).toEqual({ value: 10, count: 1, denominator: 10 });
    expect(result[2].website).toEqual({ value: 18.2, count: 2, denominator: 11 });
    expect(result[2]).toMatchObject({
      rangeStart: "2026-08-02",
      rangeEnd: "2026-08-03",
    });
  });
});
