import { describe, expect, it } from "vitest";
import {
  assistantEvaluationInputSchema,
  assistantKnowledgeInputSchema,
  buildAssistantSearchQuery,
} from "@/lib/assistant-knowledge";

describe("assistant knowledge validation", () => {
  it("normalizes optional scope and deduplicates keywords", () => {
    const result = assistantKnowledgeInputSchema.parse({
      title: "Vacation requests",
      content: "Ask your manager before booking time away.",
      category: "time_off",
      department: "  ",
      location: " Toronto ",
      keywords: ["Vacation", "vacation", "Holiday"],
      active: true,
    });

    expect(result.department).toBeNull();
    expect(result.location).toBe("Toronto");
    expect(result.keywords).toEqual(["vacation", "holiday"]);
  });

  it("rejects an evaluation without an expected answer", () => {
    expect(
      assistantEvaluationInputSchema.safeParse({
        question: "How do I request time off?",
        expected_answer: "",
      }).success,
    ).toBe(false);
  });
});

describe("buildAssistantSearchQuery", () => {
  it("creates a broad, deduplicated web-search query", () => {
    expect(buildAssistantSearchQuery("How do I submit an invoice, invoice photo?"))
      .toBe("how OR submit OR invoice OR photo");
  });

  it("returns an empty query for punctuation and short words", () => {
    expect(buildAssistantSearchQuery("I do it?"))
      .toBe("");
  });
});
