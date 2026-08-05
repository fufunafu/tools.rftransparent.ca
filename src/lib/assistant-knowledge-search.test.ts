import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedding: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/assistant-embeddings", () => ({
  createAssistantEmbedding: mocks.embedding,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ rpc: mocks.rpc }),
}));

import { searchAssistantKnowledge } from "@/lib/assistant-knowledge";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.embedding.mockResolvedValue({ embedding: [0.1, 0.2], model: "test-model" });
});

describe("assistant knowledge search", () => {
  it("uses scoped hybrid retrieval when embeddings are available", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ id: "knowledge-1", title: "Company history", rank: 0.02 }],
      error: null,
    });

    await expect(searchAssistantKnowledge(
      "When was the company founded?",
      { department: "Sales", location: "Toronto" },
    )).resolves.toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledWith("search_assistant_knowledge_hybrid", {
      query_text: "when OR was OR the OR company OR founded",
      query_embedding: [0.1, 0.2],
      employee_department: "Sales",
      employee_location: "Toronto",
      result_limit: 5,
    });
  });

  it("falls back to full-text retrieval when hybrid search is unavailable", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: "function missing" } })
      .mockResolvedValueOnce({
        data: [{ id: "knowledge-1", title: "Company history", rank: 0.8 }],
        error: null,
      });

    const results = await searchAssistantKnowledge("Company history", {});

    expect(mocks.rpc).toHaveBeenLastCalledWith("search_assistant_knowledge", expect.any(Object));
    expect(results[0]).toMatchObject({
      source_id: null,
      source_title: null,
      source_excerpt: null,
    });
  });
});
