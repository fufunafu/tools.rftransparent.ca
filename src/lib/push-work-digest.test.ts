import { describe, expect, it } from "vitest";
import {
  callbackDigestText,
  overdueDigestText,
  taskDigestText,
  taskDueBucket,
} from "@/lib/push-notifications";

describe("privacy-safe work notification copy", () => {
  it("summarizes tasks without including task content", () => {
    expect(taskDigestText(2)).toEqual({
      title: "Tasks due today",
      body: "2 assigned tasks are due today. Open RF Tools to review them.",
    });
  });

  it("keeps overdue work separate without including task content", () => {
    expect(overdueDigestText(1)).toEqual({
      title: "Overdue work needs attention",
      body: "1 task is overdue. Open RF Tools to review it.",
    });
  });

  it("classifies only valid due dates through the employee's business day", () => {
    expect(taskDueBucket("2026-08-23", "2026-08-24")).toBe("overdue");
    expect(taskDueBucket("2026-08-24", "2026-08-24")).toBe("due");
    expect(taskDueBucket("2026-08-25", "2026-08-24")).toBeNull();
    expect(taskDueBucket("not-a-date", "2026-08-24")).toBeNull();
  });

  it("summarizes callbacks without including customer details", () => {
    expect(callbackDigestText(1)).toEqual({
      title: "Callbacks need attention",
      body: "1 callback is waiting. Open RF Tools to review the queue.",
    });
  });

  it("does not send an empty digest", () => {
    expect(taskDigestText(0)).toBeNull();
    expect(overdueDigestText(0)).toBeNull();
    expect(callbackDigestText(0)).toBeNull();
  });
});
