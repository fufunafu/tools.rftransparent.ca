import { describe, expect, it } from "vitest";
import {
  getBugMetrics,
  type BugReport,
  type BugStatusValue,
} from "@/lib/bug-reports";

function bug(
  id: string,
  status: BugStatusValue,
  createdAt: string,
  repairedAt: string | null = null
): BugReport {
  return {
    id,
    system_id: "system-1",
    title: `Bug ${id}`,
    type: "other",
    status,
    description: null,
    steps: null,
    reported_by: "reporter@example.com",
    created_at: createdAt,
    updated_at: repairedAt ?? createdAt,
    repaired_at: repairedAt,
  };
}

describe("getBugMetrics", () => {
  it("summarizes attention, status, and recent report counts", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    const metrics = getBugMetrics(
      [
        bug("1", "open", "2026-07-29T10:00:00.000Z"),
        bug("2", "in_progress", "2026-07-24T10:00:00.000Z"),
        bug("3", "wont_fix", "2026-07-01T10:00:00.000Z"),
      ],
      now
    );

    expect(metrics).toMatchObject({
      total: 3,
      needsAttention: 2,
      reportedLastSevenDays: 2,
      averageRepairDays: null,
      statusCounts: {
        open: 1,
        in_progress: 1,
        repaired: 0,
        wont_fix: 1,
      },
    });
  });

  it("averages repair time from completed reports", () => {
    const metrics = getBugMetrics(
      [
        bug("1", "repaired", "2026-07-01T00:00:00.000Z", "2026-07-03T00:00:00.000Z"),
        bug("2", "repaired", "2026-07-01T00:00:00.000Z", "2026-07-05T00:00:00.000Z"),
        bug("3", "open", "2026-07-01T00:00:00.000Z"),
      ],
      Date.parse("2026-07-29T12:00:00.000Z")
    );

    expect(metrics.averageRepairDays).toBe(3);
  });
});
