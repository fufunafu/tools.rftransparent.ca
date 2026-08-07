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

import {
  listAssistantKnowledgeGaps,
  updateAssistantKnowledgeGapStatus,
} from "@/lib/assistant-knowledge";

type QueryResult = { data?: unknown; error: { code?: string; message: string } | null };

function selectChain(result: QueryResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

function updateChain(result: QueryResult) {
  const chain = {
    update: vi.fn(() => chain),
    in: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

const gapRow = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000301",
  message: "How do I book vacation?",
  rewritten_query: "book vacation",
  department: null,
  location: null,
  created_at: "2026-08-07T12:00:00Z",
  status: "open",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAssistantKnowledgeGaps", () => {
  it("groups repeats of the same question", async () => {
    mocks.from.mockReturnValue(selectChain({
      data: [
        gapRow(),
        gapRow({ id: "00000000-0000-4000-8000-000000000302", message: "how do i BOOK VACATION" }),
        gapRow({ id: "00000000-0000-4000-8000-000000000303", rewritten_query: "expense receipt", message: "Where do receipts go?" }),
      ],
      error: null,
    }));

    const { gaps, statusSupported } = await listAssistantKnowledgeGaps();

    expect(statusSupported).toBe(true);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({
      message: "How do I book vacation?",
      count: 2,
      ids: [
        "00000000-0000-4000-8000-000000000301",
        "00000000-0000-4000-8000-000000000302",
      ],
    });
    expect(gaps[1]).toMatchObject({ message: "Where do receipts go?", count: 1 });
  });

  it("falls back to the legacy select before the migration is applied", async () => {
    mocks.from
      .mockReturnValueOnce(selectChain({
        data: null,
        error: { code: "42703", message: "column assistant_knowledge_queries.status does not exist" },
      }))
      .mockReturnValueOnce(selectChain({
        data: [gapRow({ status: undefined })],
        error: null,
      }));

    const { gaps, statusSupported } = await listAssistantKnowledgeGaps();

    expect(statusSupported).toBe(false);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].status).toBe("open");
  });
});

describe("updateAssistantKnowledgeGapStatus", () => {
  it("stamps who resolved the gap and the answer that resolved it", async () => {
    const chain = updateChain({ error: null });
    mocks.from.mockReturnValue(chain);

    await updateAssistantKnowledgeGapStatus({
      ids: ["00000000-0000-4000-8000-000000000301"],
      status: "resolved",
      actor: "admin@example.com",
      knowledgeId: "00000000-0000-4000-8000-000000000401",
    });

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "resolved",
      resolved_by: "admin@example.com",
      resolution_knowledge_id: "00000000-0000-4000-8000-000000000401",
    }));
    expect(chain.in).toHaveBeenCalledWith("id", ["00000000-0000-4000-8000-000000000301"]);
  });

  it("clears resolution fields when reopening", async () => {
    const chain = updateChain({ error: null });
    mocks.from.mockReturnValue(chain);

    await updateAssistantKnowledgeGapStatus({
      ids: ["00000000-0000-4000-8000-000000000301"],
      status: "open",
      actor: "admin@example.com",
    });

    expect(chain.update).toHaveBeenCalledWith({
      status: "open",
      resolved_by: null,
      resolved_at: null,
      resolution_knowledge_id: null,
    });
  });

  it("explains the missing migration instead of a raw database error", async () => {
    mocks.from.mockReturnValue(updateChain({
      error: { code: "PGRST204", message: "Could not find the 'status' column" },
    }));

    await expect(
      updateAssistantKnowledgeGapStatus({
        ids: ["00000000-0000-4000-8000-000000000301"],
        status: "dismissed",
        actor: "admin@example.com",
      }),
    ).rejects.toThrow("assistant_gap_status migration");
  });
});
