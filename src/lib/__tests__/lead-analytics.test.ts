import { describe, expect, it } from "vitest";
import {
  buildCustomLeadTrend,
  buildLeadTrend,
  calculateLeadFunnel,
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
    expect(result.points.at(-1)).toMatchObject({ label: "Aug 3", website: 1, meta: 0 });
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
    expect(result.points[0]).toMatchObject({ label: "Sep", website: 1 });
    expect(result.points.at(-1)).toMatchObject({ label: "Aug", meta: 1 });
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
    expect(result.changePct).toBe(100);
  });

  it("uses monthly buckets for long custom ranges", () => {
    const result = buildCustomLeadTrend(
      [{ source: "meta", submitted_at: "2026-04-12T12:00:00.000Z" }],
      "2026-01-01",
      "2026-08-03",
    );

    expect(result.points).toHaveLength(8);
    expect(result.points.find((point) => point.label === "Apr")).toMatchObject({ meta: 1 });
  });
});
