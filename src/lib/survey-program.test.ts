import { describe, expect, it } from "vitest";
import {
  aggregateMetric,
  getSurveyAutomationTasks,
  isFirstThursdayOfQuarter,
  recurringFeedbackThemes,
  shouldExposeGroup,
  surveyWindowForThursday,
  validateSurveyAnswers,
  type SurveyQuestionSnapshot,
} from "@/lib/survey-program";

const questions: SurveyQuestionSnapshot[] = [
  {
    id: "q1",
    metric_key: "overall",
    prompt: "How was the week?",
    response_type: "scale",
    options: [{ value: 1, label: "Difficult" }, { value: 5, label: "Great" }],
    dimension: "experience",
    required: true,
    display_order: 1,
  },
  {
    id: "q2",
    metric_key: "follow_up",
    prompt: "Follow up?",
    response_type: "boolean",
    options: [{ value: true, label: "Yes" }, { value: false, label: "No" }],
    dimension: "support",
    required: true,
    display_order: 2,
  },
  {
    id: "q3",
    metric_key: "comment",
    prompt: "Comment",
    response_type: "text",
    options: null,
    dimension: null,
    required: false,
    display_order: 3,
  },
];

describe("survey scheduling", () => {
  it("uses Thursday afternoon through Tuesday morning in Toronto during daylight saving time", () => {
    const thursday = new Date("2026-08-06T16:00:00Z");
    const window = surveyWindowForThursday(thursday);
    expect(window.sendAt.toISOString()).toBe("2026-08-06T19:00:00.000Z");
    expect(window.reminderAt.toISOString()).toBe("2026-08-10T13:00:00.000Z");
    expect(window.closesAt.toISOString()).toBe("2026-08-11T13:00:00.000Z");
  });

  it("identifies quarterly survey weeks and suppresses the weekly dispatcher choice", () => {
    const aprilFirstThursday = new Date("2027-04-01T19:00:00Z");
    expect(isFirstThursdayOfQuarter(aprilFirstThursday)).toBe(true);
    expect(surveyWindowForThursday(aprilFirstThursday).isQuarterlyWeek).toBe(true);
  });

  it("dispatches reminders and closing work at the requested Toronto hours", () => {
    expect(getSurveyAutomationTasks(new Date("2026-08-10T13:25:00Z")).sendReminders).toBe(true);
    expect(getSurveyAutomationTasks(new Date("2026-08-11T13:25:00Z")).closeExpiredCampaigns).toBe(true);
    expect(getSurveyAutomationTasks(new Date("2026-08-06T19:25:00Z")).sendPeriodicCampaign).toBe(true);
  });
});
describe("survey answer validation", () => {
  it("normalizes valid typed answers in question order", () => {
    expect(validateSurveyAnswers(questions, [
      { metric_key: "comment", value: "  More training  " },
      { metric_key: "follow_up", value: false },
      { metric_key: "overall", value: 5 },
    ])).toEqual([
      { metric_key: "overall", value: 5 },
      { metric_key: "follow_up", value: false },
      { metric_key: "comment", value: "More training" },
    ]);
  });

  it("rejects missing required and unknown questions", () => {
    expect(() => validateSurveyAnswers(questions, [{ metric_key: "overall", value: 5 }])).toThrow("Follow up?");
    expect(() => validateSurveyAnswers(questions, [
      { metric_key: "overall", value: 5 },
      { metric_key: "follow_up", value: true },
      { metric_key: "secret", value: "x" },
    ])).toThrow("Unknown survey question");
  });
});

describe("survey reporting helpers", () => {
  it("reports median and full distribution", () => {
    expect(aggregateMetric([1, 2, 2, 5])).toEqual({
      count: 4,
      average: 2.5,
      median: 2,
      distribution: { "1": 1, "2": 2, "5": 1 },
    });
  });

  it("suppresses groups below five responses", () => {
    expect(shouldExposeGroup(4, 5)).toBe(false);
    expect(shouldExposeGroup(5, 5)).toBe(true);
  });

  it("extracts only recurring feedback terms", () => {
    expect(recurringFeedbackThemes(["Need better training tools", "Training schedule needs clarity", "Great week"]))
      .toEqual(expect.arrayContaining([{ theme: "training", mentions: 2 }]));
  });
});
