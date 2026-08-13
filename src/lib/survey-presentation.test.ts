import { describe, expect, it } from "vitest";
import {
  SURVEY_RATING_OPTIONS,
  formatSurveyWeek,
} from "@/lib/survey-presentation";

describe("survey presentation", () => {
  it("keeps a complete ordered five-point rating scale", () => {
    expect(SURVEY_RATING_OPTIONS.map((option) => option.value)).toEqual([1, 2, 3, 4, 5]);
    expect(SURVEY_RATING_OPTIONS.every((option) => option.label.length > 0)).toBe(true);
  });

  it("formats the survey week without timezone drift", () => {
    expect(formatSurveyWeek("2026-08-10")).toBe("August 10, 2026");
  });
});
