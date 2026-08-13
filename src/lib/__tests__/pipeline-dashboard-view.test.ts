import { describe, expect, it } from "vitest";
import {
  getForecastConfidence,
  getPipelineAttentionItems,
  getPipelineDisplayState,
  getPipelineManagementSummary,
  getPipelineTeamHighlights,
  parsePipelineView,
  PIPELINE_CONTENT_OWNERSHIP,
} from "@/lib/pipeline-dashboard-view";

describe("pipeline dashboard view model", () => {
  it("parses supported tabs and defaults invalid values to overview", () => {
    expect(parsePipelineView("forecast")).toBe("forecast");
    expect(parsePipelineView("team")).toBe("team");
    expect(parsePipelineView("anything")).toBe("overview");
    expect(parsePipelineView(undefined)).toBe("overview");
  });

  it("prioritizes the three most actionable pipeline warnings", () => {
    const items = getPipelineAttentionItems({
      conversionRate: 12,
      avgCycleTimeDays: 25,
      pipelineValue: 25_000,
      invoiceSentDrafts: 9,
      openDrafts: 7,
      completedDrafts: 0,
      totalDrafts: 16,
      avgSaleValue: 0,
    });

    expect(items.map((item) => item.id)).toEqual([
      "no-conversions",
      "low-conversion",
      "unpaid-invoices",
    ]);
  });

  it("derives distinct management highlights for the team tab", () => {
    const highlights = getPipelineTeamHighlights([
      { repName: "Alex", wonRevenue: 20_000, conversionRate: 35, pipelineValue: 4_000 },
      { repName: "Jordan", wonRevenue: 12_000, conversionRate: 60, pipelineValue: 9_000 },
    ]);

    expect(highlights.strongestRep?.repName).toBe("Alex");
    expect(highlights.bestConverter?.repName).toBe("Jordan");
    expect(highlights.largestPipeline?.repName).toBe("Jordan");
  });

  it("includes quote-attributed revenue in the management summary", () => {
    const summary = getPipelineManagementSummary(
      [{ repName: "Alex", wonRevenue: 20_000, conversionRate: 35, pipelineValue: 4_000 }],
      31_500,
    );

    expect(summary.strongestRep?.repName).toBe("Alex");
    expect(summary.quoteAttributedRevenue).toBe(31_500);
  });

  it("derives forecast confidence from history and fallback usage", () => {
    expect(getForecastConfidence({
      monthlyForecasts: Array.from({ length: 12 }, () => ({ isFallback: false })),
      seasonalPattern: Array.from({ length: 12 }, () => ({ revenue: 1_000 })),
    }).level).toBe("High");

    expect(getForecastConfidence({
      monthlyForecasts: Array.from({ length: 12 }, () => ({ isFallback: true })),
      seasonalPattern: [],
    }).level).toBe("Limited");
  });

  it.each([
    [{ hasData: false, isEmpty: false, isPartial: false, loading: true, refreshing: false, error: "" }, "loading"],
    [{ hasData: false, isEmpty: false, isPartial: false, loading: false, refreshing: false, error: "Shopify failed" }, "error"],
    [{ hasData: true, isEmpty: false, isPartial: false, loading: false, refreshing: true, error: "", cachedAt: "2026-08-13" }, "refreshing"],
    [{ hasData: true, isEmpty: false, isPartial: false, loading: false, refreshing: false, error: "Shopify failed", cachedAt: "2026-08-13" }, "stale"],
    [{ hasData: true, isEmpty: false, isPartial: true, loading: false, refreshing: false, error: "", cachedAt: "2026-08-13" }, "partial"],
    [{ hasData: true, isEmpty: true, isPartial: false, loading: false, refreshing: false, error: "" }, "empty"],
    [{ hasData: true, isEmpty: false, isPartial: false, loading: false, refreshing: false, error: "", cachedAt: "2026-08-13" }, "cached"],
    [{ hasData: true, isEmpty: false, isPartial: false, loading: false, refreshing: false, error: "" }, "ready"],
  ] as const)("maps dashboard state %# to %s", (input, expected) => {
    expect(getPipelineDisplayState(input)).toBe(expected);
  });

  it("assigns each metric and chart to exactly one tab", () => {
    const contentIds = Object.values(PIPELINE_CONTENT_OWNERSHIP).flat();
    expect(new Set(contentIds).size).toBe(contentIds.length);
  });
});
