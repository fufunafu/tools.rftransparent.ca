import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  zodTextFormat: vi.fn(() => ({ type: "json_schema" })),
}));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    responses = { parse: mocks.parse };
  },
}));
vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: mocks.zodTextFormat,
}));

import { generateAssistantKnowledgeDraft } from "@/lib/assistant-knowledge-draft";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_KNOWLEDGE_MODEL", "gpt-5.6-luna");
  mocks.parse.mockResolvedValue({
    output_parsed: {
      publishable: true,
      reviewNote: "Ready for review",
      drafts: [{
        title: "Where do I send receipts?",
        content: "Send receipt photos in WhatsApp.",
        category: "expenses",
        department: "",
        location: "",
        keywords: ["receipt", "expense", "photo", "whatsapp"],
        sourceExcerpt: "Send receipt photos in WhatsApp.",
      }],
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenAI knowledge drafting", () => {
  it("uses structured output without storing the pasted source", async () => {
    const result = await generateAssistantKnowledgeDraft({
      source: "Email text",
      refinement: "Make this specific to Accounting.",
      currentDrafts: [{
        title: "Where do I send receipts?",
        content: "Send receipt photos in WhatsApp.",
        category: "expenses",
        department: null,
        location: null,
        keywords: ["receipt"],
        active: true,
      }],
      departments: ["Accounting"],
      locations: ["Toronto"],
      safetyIdentifier: "hashed-admin-id",
    });

    expect(result.publishable).toBe(true);
    expect(mocks.parse).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-luna",
      input: JSON.stringify({
        sourceMaterial: "Email text",
        adminRefinement: "Make this specific to Accounting.",
        currentKnowledgeBits: [{
          title: "Where do I send receipts?",
          content: "Send receipt photos in WhatsApp.",
          category: "expenses",
          department: null,
          location: null,
          keywords: ["receipt"],
          active: true,
        }],
      }),
      store: false,
      safety_identifier: "hashed-admin-id",
      reasoning: { effort: "low" },
      text: expect.objectContaining({
        format: { type: "json_schema" },
      }),
    }));
  });
});
