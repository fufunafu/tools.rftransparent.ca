import { describe, expect, it } from "vitest";
import {
  buildCustomLeadTrend,
  buildLeadTrend,
  calculateLeadFunnel,
  calculateLeadFunnelBySource,
  isLeadInCustomDateRange,
} from "@/lib/lead-analytics";

const NOW = new Date("2026-08-03T16:00:00.000Z");

describe("calculateLeadFunnel", () => {
  it("uses all leads as the denominator for call, quote, and order rates", () => {
    const result = calculateLeadFunnel([
      { call_status: "called", quote_number: "#D1", outcome: "won" },
      { call_status: "no_answer", quote_number: "#D2", outcome: "quoted" },
      { call_status: "not_called", quote_number: null, outcome: "new" },
      { call_status: "not_called", quote_number: null, outcome: "lost" },
    ]);

    expect(result).toEqual({
      total: 4,
      callEligible: 4,
      attempted: 2,
      quoted: 2,
      won: 1,
      callRate: 50,
      quoteRate: 50,
      conversionRate: 25,
    });
  });

  it("counts no-answer calls as attempts and rounds rates to one decimal", () => {
    const result = calculateLeadFunnel([
      { call_status: "no_answer", quote_number: "#D1", outcome: "quoted" },
      { call_status: "not_called", quote_number: null, outcome: "new" },
      { call_status: "not_called", quote_number: null, outcome: "new" },
    ]);

    expect(result.callRate).toBe(33.3);
    expect(result.quoteRate).toBe(33.3);
    expect(result.conversionRate).toBe(0);
  });

  it("returns zero rates for an empty lead set", () => {
    expect(calculateLeadFunnel([])).toEqual({
      total: 0,
      callEligible: 0,
      attempted: 0,
      quoted: 0,
      won: 0,
      callRate: 0,
      quoteRate: 0,
      conversionRate: 0,
    });
  });

  it("excludes Not Applicable leads from funnel denominators", () => {
    const result = calculateLeadFunnel([
      { call_status: "called", quote_number: "#D1", outcome: "won" },
      { call_status: "not_called", quote_number: null, outcome: "not_applicable" },
    ]);

    expect(result).toMatchObject({
      total: 1,
      attempted: 1,
      quoted: 1,
      won: 1,
      callRate: 100,
      quoteRate: 100,
      conversionRate: 100,
    });
  });

  it("includes historical imports whose workflow status was unknown", () => {
    const result = calculateLeadFunnel([
      {
        call_status: "not_called",
        phone: "5145551234",
        quote_number: null,
        outcome: "not_applicable",
        not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown",
        raw_payload: { historical_import: { source_key: "historical-1" } },
      },
      {
        call_status: "not_called",
        phone: "5145555678",
        quote_number: null,
        outcome: "not_applicable",
        not_applicable_reason: "Spam: marketing solicitation",
      },
    ]);

    expect(result).toMatchObject({
      total: 1,
      callEligible: 1,
      attempted: 0,
      quoted: 0,
      won: 0,
      callRate: 0,
    });
  });

  it("does not penalize call rate when an uncalled lead has no phone", () => {
    const result = calculateLeadFunnel([
      {
        call_status: "called",
        phone: "5145551234",
        quote_number: "#D1",
        outcome: "quoted",
      },
      {
        call_status: "not_called",
        phone: null,
        quote_number: null,
        outcome: "new",
      },
    ]);

    expect(result).toMatchObject({
      total: 2,
      callEligible: 1,
      attempted: 1,
      callRate: 100,
      quoteRate: 50,
    });
  });
});

describe("calculateLeadFunnelBySource", () => {
  it("uses each source total as the denominator for its rates", () => {
    const result = calculateLeadFunnelBySource([
      { source: "website", call_status: "called", quote_number: "#D1", outcome: "quoted" },
      { source: "website", call_status: "not_called", quote_number: null, outcome: "new" },
      { source: "meta", call_status: "no_answer", quote_number: null, outcome: "contacted" },
      { source: "meta", call_status: "called", quote_number: "#D2", outcome: "won" },
      { source: "meta", call_status: "not_called", quote_number: null, outcome: "new" },
    ]);

    expect(result.website).toMatchObject({
      total: 2,
      attempted: 1,
      quoted: 1,
      callRate: 50,
      quoteRate: 50,
    });
    expect(result.meta).toMatchObject({
      total: 3,
      attempted: 2,
      quoted: 1,
      callRate: 66.7,
      quoteRate: 33.3,
    });
  });

  it("returns zeroed metrics when a source has no leads", () => {
    const result = calculateLeadFunnelBySource([
      { source: "website", call_status: "called", quote_number: null, outcome: "contacted" },
    ]);

    expect(result.meta).toEqual({
      total: 0,
      callEligible: 0,
      attempted: 0,
      quoted: 0,
      won: 0,
      callRate: 0,
      quoteRate: 0,
      conversionRate: 0,
    });
  });

});

describe("buildLeadTrend", () => {
  it("builds seven daily buckets and compares them with the preceding seven days", () => {
    const result = buildLeadTrend(
      [
        { source: "website", submitted_at: "2026-08-03T13:00:00.000Z" },
        { source: "meta", submitted_at: "2026-07-28T13:00:00.000Z" },
        { source: "website", submitted_at: "2026-07-27T13:00:00.000Z" },
        { source: "meta", submitted_at: "2026-07-21T13:00:00.000Z" },
        { source: "website", submitted_at: "2026-07-27T17:00:00.000Z" },
      ],
      "7d",
      NOW,
    );

    expect(result.points).toHaveLength(7);
    expect(result.points[0]).toMatchObject({
      rangeStart: "2026-07-28",
      rangeEnd: "2026-07-28",
      meta: 1,
    });
    expect(result.points.at(-1)).toMatchObject({
      rangeStart: "2026-08-03",
      rangeEnd: "2026-08-03",
      website: 1,
    });
    expect(result.current).toEqual({ total: 2, website: 1, meta: 1 });
    expect(result.previous).toEqual({ total: 2, website: 1, meta: 1 });
    expect(result.changePct).toBe(0);
  });

  it("separates website and Meta leads into daily Toronto buckets", () => {
    const result = buildLeadTrend(
      [
        { source: "website", submitted_at: "2026-08-03T13:00:00.000Z" },
        { source: "meta", submitted_at: "2026-08-03T02:00:00.000Z" },
        { source: "meta", submitted_at: "2026-07-20T12:00:00.000Z" },
      ],
      "30d",
      NOW,
    );

    expect(result.current).toEqual({ total: 3, website: 1, meta: 2 });
    expect(result.points.at(-1)).toMatchObject({
      label: "Aug 3",
      rangeStart: "2026-08-03",
      rangeEnd: "2026-08-03",
      website: 1,
      meta: 0,
    });
    expect(result.points.find((point) => point.label === "Aug 2")).toMatchObject({ meta: 1 });
  });

  it("compares the selected period with the preceding period", () => {
    const result = buildLeadTrend(
      [
        { source: "website", submitted_at: "2026-08-01T12:00:00.000Z" },
        { source: "meta", submitted_at: "2026-07-15T12:00:00.000Z" },
        { source: "website", submitted_at: "2026-06-20T12:00:00.000Z" },
      ],
      "30d",
      NOW,
    );

    expect(result.current.total).toBe(2);
    expect(result.previous.total).toBe(1);
    expect(result.changePct).toBe(100);
  });

  it("groups a year of leads into calendar months", () => {
    const result = buildLeadTrend(
      [
        { source: "meta", submitted_at: "2026-08-01T12:00:00.000Z" },
        { source: "website", submitted_at: "2026-01-10T12:00:00.000Z" },
        { source: "website", submitted_at: "2025-09-10T12:00:00.000Z" },
      ],
      "12m",
      NOW,
    );

    expect(result.points).toHaveLength(12);
    expect(result.points[0]).toMatchObject({
      label: "Sep",
      rangeStart: "2025-09-01",
      rangeEnd: "2025-09-30",
      website: 1,
    });
    expect(result.points.at(-1)).toMatchObject({
      label: "Aug",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-31",
      meta: 1,
    });
  });

  it("cuts the previous monthly period off at the same Toronto date and time", () => {
    const result = buildLeadTrend(
      [
        { source: "website", submitted_at: "2025-08-03T15:00:00.000Z" },
        { source: "meta", submitted_at: "2025-08-03T17:00:00.000Z" },
      ],
      "12m",
      NOW,
    );

    expect(result.previous).toEqual({ total: 1, website: 1, meta: 0 });
  });

  it("groups the full lead history into monthly buckets", () => {
    const result = buildLeadTrend(
      [
        { source: "website", submitted_at: "2024-03-10T12:00:00.000Z" },
        { source: "meta", submitted_at: "2025-11-15T12:00:00.000Z" },
        { source: "website", submitted_at: "2026-08-01T12:00:00.000Z" },
        { source: "meta", submitted_at: "2026-08-10T12:00:00.000Z" },
      ],
      "all",
      NOW,
    );

    expect(result.points[0]).toMatchObject({
      label: "Mar",
      rangeStart: "2024-03-10",
      website: 1,
    });
    expect(result.points.at(-1)).toMatchObject({
      label: "Aug",
      rangeEnd: "2026-08-03",
      website: 1,
      meta: 0,
    });
    expect(result.current).toEqual({ total: 3, website: 2, meta: 1 });
    expect(result.previous.total).toBe(0);
    expect(result.changePct).toBeNull();
  });

  it("supports an exact custom date range", () => {
    const result = buildCustomLeadTrend(
      [
        { source: "website", submitted_at: "2026-08-03T13:00:00.000Z" },
        { source: "meta", submitted_at: "2026-08-01T13:00:00.000Z" },
        { source: "website", submitted_at: "2026-07-30T13:00:00.000Z" },
      ],
      "2026-08-01",
      "2026-08-03",
    );

    expect(result.current).toEqual({ total: 2, website: 1, meta: 1 });
    expect(result.previous).toEqual({ total: 1, website: 1, meta: 0 });
    expect(result.points).toHaveLength(3);
    expect(result.points[0]).toMatchObject({
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-01",
    });
    expect(result.changePct).toBe(100);
  });

  it("uses the same time-of-day cutoff when a custom range ends today", () => {
    const result = buildCustomLeadTrend(
      [
        { source: "website", submitted_at: "2026-07-31T15:00:00.000Z" },
        { source: "meta", submitted_at: "2026-07-31T17:00:00.000Z" },
      ],
      "2026-08-01",
      "2026-08-03",
      NOW,
    );

    expect(result.previous).toEqual({ total: 1, website: 1, meta: 0 });
  });

  it("uses monthly buckets for long custom ranges", () => {
    const result = buildCustomLeadTrend(
      [{ source: "meta", submitted_at: "2026-04-12T12:00:00.000Z" }],
      "2026-01-01",
      "2026-08-03",
    );

    expect(result.points).toHaveLength(8);
    expect(result.points.find((point) => point.label === "Apr")).toMatchObject({
      rangeStart: "2026-04-01",
      rangeEnd: "2026-04-30",
      meta: 1,
    });
    expect(result.points.at(-1)).toMatchObject({
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-03",
    });
  });
});

describe("isLeadInCustomDateRange", () => {
  it("includes both endpoints using Toronto calendar dates", () => {
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-01T04:00:00.000Z" },
      "2026-08-01",
      "2026-08-03",
    )).toBe(true);
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-04T03:59:59.999Z" },
      "2026-08-01",
      "2026-08-03",
    )).toBe(true);
  });

  it("excludes submissions outside the selected Toronto dates", () => {
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-01T03:59:59.999Z" },
      "2026-08-01",
      "2026-08-03",
    )).toBe(false);
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-04T04:00:00.000Z" },
      "2026-08-01",
      "2026-08-03",
    )).toBe(false);
  });

  it("supports reversed endpoints and rejects invalid dates", () => {
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-02T12:00:00.000Z" },
      "2026-08-03",
      "2026-08-01",
    )).toBe(true);
    expect(isLeadInCustomDateRange(
      { submitted_at: "2026-08-02T12:00:00.000Z" },
      "",
      "2026-08-03",
    )).toBe(false);
  });
});
