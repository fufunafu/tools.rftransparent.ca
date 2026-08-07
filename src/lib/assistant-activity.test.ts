import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/assistant-embeddings", () => ({
  createAssistantEmbedding: vi.fn(),
}));

import { listAssistantActivity } from "@/lib/assistant-knowledge";

type QueryResult = { data?: unknown; error: { message: string } | null };

function thenableChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "gte", "order", "limit", "eq", "in"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<QueryResult>;
}

const queryRow = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000501",
  message: "How do I book vacation?",
  rewritten_query: "book vacation",
  department: "Sales",
  location: "Toronto",
  matched: true,
  knowledge_ids: ["00000000-0000-4000-8000-000000000401"],
  created_at: "2026-08-07T12:00:00Z",
  employees: { name: "Alex" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAssistantActivity", () => {
  it("returns queries with employee names and answer usage counts", async () => {
    const queriesChain = thenableChain({
      data: [
        queryRow(),
        queryRow({ id: "00000000-0000-4000-8000-000000000502", employees: null, matched: false, knowledge_ids: [] }),
      ],
      error: null,
    });
    const titlesChain = thenableChain({
      data: [{ id: "00000000-0000-4000-8000-000000000401", title: "Vacation policy" }],
      error: null,
    });
    mocks.from.mockImplementation((table: string) =>
      table === "assistant_knowledge_queries" ? queriesChain : titlesChain,
    );

    const { queries, usage } = await listAssistantActivity({ days: 30 });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({ message: "How do I book vacation?", employee_name: "Alex", matched: true });
    expect(queries[1]).toMatchObject({ employee_name: null, matched: false });
    expect(usage).toEqual([
      { knowledgeId: "00000000-0000-4000-8000-000000000401", title: "Vacation policy", count: 1 },
    ]);
  });

  it("applies department and matched filters", async () => {
    const queriesChain = thenableChain({ data: [], error: null });
    mocks.from.mockReturnValue(queriesChain);

    await listAssistantActivity({ days: 7, department: "Sales", matched: false });

    expect(queriesChain.eq).toHaveBeenCalledWith("department", "Sales");
    expect(queriesChain.eq).toHaveBeenCalledWith("matched", false);
  });

  it("throws a readable error when the query fails", async () => {
    mocks.from.mockReturnValue(thenableChain({ data: null, error: { message: "boom" } }));

    await expect(listAssistantActivity()).rejects.toThrow("Could not load assistant activity: boom");
  });
});
