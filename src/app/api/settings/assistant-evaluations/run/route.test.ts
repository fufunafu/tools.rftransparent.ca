import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  listCases: vi.fn(),
  searchKnowledge: vi.fn(),
  insertRun: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  listAssistantEvaluationCases: mocks.listCases,
  searchAssistantKnowledge: mocks.searchKnowledge,
}));
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({ insert: mocks.insertRun }),
  }),
}));

import { POST } from "@/app/api/settings/assistant-evaluations/run/route";

function request(body: unknown = {}) {
  return new NextRequest("https://tools.rftransparent.ca/api/settings/assistant-evaluations/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
  latest_run: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_ASSISTANT_SHARED_SECRET", "shared-secret");
  vi.stubEnv("INVOICEBOX_URL", "https://invoicebox.example.com/");
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.listCases.mockResolvedValue([evaluationCase]);
  mocks.searchKnowledge.mockResolvedValue([{ id: "knowledge-1", title: "Invoices" }]);
  mocks.insertRun.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assistant evaluation runner", () => {
  it("requires an authenticated administrator", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.listCases).not.toHaveBeenCalled();
  });

  it("retrieves scoped knowledge, calls InvoiceBox, and stores the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      answer: "Send a photo in WhatsApp.",
      passed: true,
      reason: "The required filing instruction is present.",
      model: "anthropic/claude-haiku-4.5",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ id: evaluationCase.id }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].passed).toBe(true);
    expect(mocks.searchKnowledge).toHaveBeenCalledWith(
      evaluationCase.question,
      { department: "Accounting", location: "Toronto" },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://invoicebox.example.com/api/internal/assistant/evaluate",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(mocks.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      case_id: evaluationCase.id,
      passed: true,
      run_by: "admin@example.com",
    }));
  });
});
