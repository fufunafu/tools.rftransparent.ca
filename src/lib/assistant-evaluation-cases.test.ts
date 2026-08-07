import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    query,
  };
});

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: mocks.from }),
}));

import { listAssistantEvaluationCases } from "@/lib/assistant-knowledge";

const evaluationCase = {
  id: "00000000-0000-4000-8000-000000000201",
  question: "How do I submit an invoice?",
  expected_answer: "Send a photo in WhatsApp.",
  department: "Accounting",
  location: "Toronto",
  active: true,
  created_by: "admin@example.com",
  updated_by: "admin@example.com",
  created_at: "2026-08-04T12:00:00Z",
  updated_at: "2026-08-04T12:00:00Z",
};

const latestRun = {
  id: "00000000-0000-4000-8000-000000000301",
  case_id: evaluationCase.id,
  answer: "Send a photo in WhatsApp.",
  passed: true,
  reason: "Matches.",
  model: "test-model",
  run_by: "admin@example.com",
  created_at: "2026-08-07T12:00:00Z",
  status: "completed",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.select.mockReturnValue(mocks.query);
  mocks.query.order.mockReturnValue(mocks.query);
});

describe("listAssistantEvaluationCases", () => {
  it("loads only the latest run for each evaluation case", async () => {
    mocks.query.limit.mockResolvedValueOnce({
      data: [{ ...evaluationCase, assistant_evaluation_runs: [latestRun] }],
      error: null,
    });

    const cases = await listAssistantEvaluationCases();

    expect(mocks.query.limit).toHaveBeenCalledWith(1, {
      referencedTable: "assistant_evaluation_runs",
    });
    expect(cases).toEqual([{ ...evaluationCase, latest_run: latestRun }]);
  });

  it("retries the bounded query without status on a legacy database", async () => {
    mocks.query.limit
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST204", message: "Could not find the 'status' column" },
      })
      .mockResolvedValueOnce({
        data: [{
          ...evaluationCase,
          assistant_evaluation_runs: [{ ...latestRun, status: undefined }],
        }],
        error: null,
      });

    const cases = await listAssistantEvaluationCases();

    expect(mocks.query.limit).toHaveBeenCalledTimes(2);
    expect(mocks.query.select.mock.calls[1]?.[0]).not.toContain("status");
    expect(cases[0]?.latest_run?.status).toBe("completed");
  });
});
