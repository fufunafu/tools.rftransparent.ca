import { describe, expect, it } from "vitest";
import { getAutomationHealth } from "@/lib/automation-status";

const NOW = new Date("2026-08-03T16:00:00.000Z").getTime();

describe("automation health", () => {
  it("reports unknown before the first tracked run", () => {
    expect(getAutomationHealth(undefined, 36, NOW)).toBe("unknown");
  });

  it("keeps failures visible regardless of age", () => {
    expect(
      getAutomationHealth(
        { status: "error", started_at: "2026-08-03T15:00:00.000Z" },
        36,
        NOW,
      ),
    ).toBe("error");
  });

  it("reports a recent successful or skipped run as healthy", () => {
    expect(
      getAutomationHealth(
        { status: "success", started_at: "2026-08-03T15:00:00.000Z" },
        36,
        NOW,
      ),
    ).toBe("healthy");
    expect(
      getAutomationHealth(
        { status: "skipped", started_at: "2026-08-03T15:00:00.000Z" },
        36,
        NOW,
      ),
    ).toBe("healthy");
  });

  it("reports jobs that missed their expected window as stale", () => {
    expect(
      getAutomationHealth(
        { status: "success", started_at: "2026-08-01T00:00:00.000Z" },
        36,
        NOW,
      ),
    ).toBe("stale");
  });
});
