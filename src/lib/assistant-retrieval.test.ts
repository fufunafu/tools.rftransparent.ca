import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    responses = { create: mocks.create };
  },
}));

import {
  formatAssistantKnowledgeContext,
  isSmalltalkMessage,
  rewriteAssistantRetrievalQuery,
} from "@/lib/assistant-retrieval";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.create.mockResolvedValue({ output_text: "When was RF Transparent founded?" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("assistant retrieval", () => {
  it("rewrites a follow-up using recent conversation", async () => {
    await expect(rewriteAssistantRetrievalQuery({
      message: "When was it founded?",
      history: [{ role: "user", content: "Tell me about RF Transparent." }],
      safetyIdentifier: "safe-user",
    })).resolves.toBe("When was RF Transparent founded?");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ store: false }));
  });

  it("does not call the model for a standalone question", async () => {
    await expect(rewriteAssistantRetrievalQuery({
      message: "Where is the Toronto warehouse?",
      history: [],
      safetyIdentifier: "safe-user",
    })).resolves.toBe("Where is the Toronto warehouse?");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("formats entries as ready-to-inject grounded context", () => {
    expect(formatAssistantKnowledgeContext([{
      id: "knowledge-1",
      title: "Company history",
      content: "Operations began around 2015.",
      source_title: "Founder interview",
    }])).toContain("Reference: Founder interview (knowledge-1)");
  });

  it("recognizes greetings and acknowledgements as smalltalk", () => {
    for (const message of ["hey", "Hi!", "ok", "OK.", "thanks", "Thank you!", "merci beaucoup", "Bonjour", "ça va", "👍", "ok merci"]) {
      expect(isSmalltalkMessage(message), message).toBe(true);
    }
  });

  it("treats real questions as not smalltalk", () => {
    for (const message of [
      "hey how do I submit an invoice",
      "Where is the Toronto warehouse?",
      "ok what about vacation days",
      "vacation",
      "Est-ce que je peux prendre congé demain?",
    ]) {
      expect(isSmalltalkMessage(message), message).toBe(false);
    }
  });
});
