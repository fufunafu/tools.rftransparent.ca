import { describe, expect, it } from "vitest";
import {
  assistantKnowledgeDraftRequestSchema,
  buildAssistantKnowledgeDraftInstructions,
  normalizeGeneratedAssistantKnowledgeDraft,
} from "@/lib/assistant-knowledge-draft";

describe("assistant knowledge draft validation", () => {
  it("trims pasted source text", () => {
    expect(assistantKnowledgeDraftRequestSchema.parse({ source: "  Policy note  " })).toEqual({
      source: "Policy note",
    });
  });

  it("accepts long transcripts while enforcing the source ceiling", () => {
    expect(
      assistantKnowledgeDraftRequestSchema.safeParse({ source: "x".repeat(100000) }).success,
    ).toBe(true);
    expect(
      assistantKnowledgeDraftRequestSchema.safeParse({ source: "x".repeat(120001) }).success,
    ).toBe(false);
  });

  it("treats pasted content as reference material and provides allowed scopes", () => {
    const instructions = buildAssistantKnowledgeDraftInstructions({
      departments: ["Accounting"],
      locations: ["Toronto"],
    });

    expect(instructions).toContain("untrusted reference material");
    expect(instructions).toContain("Conversational material is valid source material");
    expect(instructions).toContain("Distinguish dates that refer to different milestones");
    expect(instructions).toContain("Do not reject a source merely because it is long");
    expect(instructions).toContain("Classify the source by employee intent");
    expect(instructions).toContain("ten distinct topics should normally produce ten bits");
    expect(instructions).toContain("Every bit must stand alone");
    expect(instructions).toContain('Allowed departments: ["Accounting"]');
    expect(instructions).toContain('Allowed locations: ["Toronto"]');
  });

  it("normalizes multiple knowledge bits and accepts only known scopes", () => {
    const result = normalizeGeneratedAssistantKnowledgeDraft(
      {
        publishable: true,
        reviewNote: "Ready for review",
        drafts: [
          {
            title: "How do I submit an expense receipt?",
            content: "Send a clear receipt photo in the WhatsApp chat.",
            category: "expenses",
            department: "accounting",
            location: "Invented office",
            keywords: ["Receipt", "expense", "RECEIPT"],
            sourceExcerpt: "Send a clear receipt photo.",
          },
          {
            title: "Who approves expense receipts?",
            content: "Accounting approves submitted expense receipts.",
            category: "expenses",
            department: "",
            location: "Toronto",
            keywords: ["approval", "accounting"],
            sourceExcerpt: "Accounting approves submitted expense receipts.",
          },
        ],
      },
      { departments: ["Accounting"], locations: ["Toronto"] },
      "test-model",
    );

    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toMatchObject({
      department: "Accounting",
      location: "",
      keywords: ["receipt", "expense"],
      active: true,
    });
    expect(result.drafts[1]).toMatchObject({
      department: "",
      location: "Toronto",
    });
  });

  it("removes exact duplicate topic drafts", () => {
    const result = normalizeGeneratedAssistantKnowledgeDraft(
      {
        publishable: true,
        reviewNote: "Ready for review",
        drafts: [
          {
            title: "Vacation requests",
            content: "Ask your manager before booking time away.",
            category: "time_off",
            department: "",
            location: "",
            keywords: ["vacation"],
            sourceExcerpt: "Ask your manager before booking time away.",
          },
          {
            title: "VACATION REQUESTS",
            content: "Submit vacation requests to your manager.",
            category: "time_off",
            department: "",
            location: "",
            keywords: ["holiday"],
            sourceExcerpt: "Submit vacation requests to your manager.",
          },
        ],
      },
      { departments: [], locations: [] },
      "test-model",
    );

    expect(result.drafts).toHaveLength(1);
  });

  it("does not create a draft from unsuitable source material", () => {
    const result = normalizeGeneratedAssistantKnowledgeDraft(
      {
        publishable: false,
        reviewNote: "The email does not contain an approved procedure.",
        drafts: [],
      },
      { departments: [], locations: [] },
      "test-model",
    );

    expect(result).toEqual({
      publishable: false,
      reviewNote: "The email does not contain an approved procedure.",
      drafts: [],
      model: "test-model",
    });
  });
});
