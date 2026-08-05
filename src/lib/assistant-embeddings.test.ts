import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", () => ({
  default: class OpenAIMock {
    embeddings = { create: mocks.create };
  },
}));

import {
  ASSISTANT_EMBEDDING_DIMENSIONS,
  buildAssistantKnowledgeEmbeddingInput,
  createAssistantEmbedding,
} from "@/lib/assistant-embeddings";

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.create.mockResolvedValue({
    data: [{ index: 0, embedding: Array(ASSISTANT_EMBEDDING_DIMENSIONS).fill(0.25) }],
    model: "text-embedding-3-small",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("assistant embeddings", () => {
  it("creates a fixed-size retrieval vector", async () => {
    const result = await createAssistantEmbedding("Company history", "safe-user");

    expect(result.embedding).toHaveLength(1536);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: ["Company history"],
      user: "safe-user",
    }));
  });

  it("builds an embedding document from all retrieval fields", () => {
    expect(buildAssistantKnowledgeEmbeddingInput({
      title: "Company history",
      content: "Operations began around 2015.",
      category: "company",
      keywords: ["founded", "created"],
    })).toContain("Search terms: founded, created");
  });
});
