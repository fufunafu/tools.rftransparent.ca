import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  listCases: vi.fn(),
  searchKnowledge: vi.fn(),
  getInitialPrompt: vi.fn(),
  insertRun: vi.fn(),
  recordSettingChange: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  listAssistantEvaluationCases: mocks.listCases,
  searchAssistantKnowledge: mocks.searchKnowledge,
}));
vi.mock("@/lib/assistant-prompt", () => ({
  getAssistantInitialPrompt: mocks.getInitialPrompt,
}));
vi.mock("@/lib/settings-audit", () => ({
  recordSettingChange: mocks.recordSettingChange,
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
  mocks.getInitialPrompt.mockResolvedValue("Use only approved company knowledge.");
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      initialPrompt: "Use only approved company knowledge.",
      question: evaluationCase.question,
    });
    expect(mocks.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      case_id: evaluationCase.id,
      passed: true,
      status: "completed",
      run_by: "admin@example.com",
    }));
    expect(mocks.recordSettingChange).not.toHaveBeenCalled();
  });

  it("sends the same knowledge context production injects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      answer: "Send a photo in WhatsApp.",
      passed: true,
      reason: "Matches.",
    }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.searchKnowledge.mockResolvedValue([
      { id: "knowledge-1", title: "Invoices", content: "Send a photo.", source_title: "Handbook" },
    ]);

    await POST(request({ id: evaluationCase.id }));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.knowledgeContext).toContain("[Knowledge 1: Invoices]");
    expect(body.knowledgeContext).toContain("Send a photo.");
  });

  it("stores an infrastructure failure as an error run, not a failed answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const response = await POST(request({ id: evaluationCase.id }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({ passed: false, status: "error", reason: "fetch failed" });
    expect(mocks.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      case_id: evaluationCase.id,
      status: "error",
      reason: "fetch failed",
    }));
  });

  it("retries the insert without status when the column is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      answer: "Send a photo in WhatsApp.",
      passed: true,
      reason: "Matches.",
    }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.insertRun
      .mockResolvedValueOnce({
        error: { code: "PGRST204", message: "Could not find the 'status' column" },
      })
      .mockResolvedValueOnce({ error: null });

    const response = await POST(request({ id: evaluationCase.id }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].passed).toBe(true);
    expect(mocks.insertRun).toHaveBeenCalledTimes(2);
    expect(mocks.insertRun.mock.calls[1]?.[0]).not.toHaveProperty("status");
  });

  it("runs every active case and records an audit summary for full runs", async () => {
    const secondCase = { ...evaluationCase, id: "00000000-0000-4000-8000-000000000202" };
    const thirdCase = { ...evaluationCase, id: "00000000-0000-4000-8000-000000000203" };
    mocks.listCases.mockResolvedValue([evaluationCase, secondCase, thirdCase]);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return Response.json({
        answer: "Send a photo in WhatsApp.",
        passed: true,
        reason: "Matches.",
      });
    }));

    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(3);
    expect(maxInFlight).toBe(3);
    expect(mocks.insertRun).toHaveBeenCalledTimes(3);
    expect(mocks.recordSettingChange).toHaveBeenCalledWith({
      area: "assistant",
      actor: "admin@example.com",
      summary: "Ran 3 assistant quality checks: 3 passed, 0 failed, 0 errors",
    });
  });
});
