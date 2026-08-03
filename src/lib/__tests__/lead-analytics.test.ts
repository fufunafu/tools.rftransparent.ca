import { describe, expect, it } from "vitest";
import { buildCustomLeadTrend, buildLeadTrend } from "@/lib/lead-analytics";

const NOW = new Date("2026-08-03T16:00:00.000Z");

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
