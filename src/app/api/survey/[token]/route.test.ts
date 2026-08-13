import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSupabaseMock, rpcMock } = vi.hoisted(() => ({
  getSupabaseMock: vi.fn(),
  rpcMock: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: getSupabaseMock }));

import { POST } from "@/app/api/survey/[token]/route";

const campaign = {
  id: "campaign-id",
  name: "Weekly pulse",
  purpose: "Find support problems.",
  survey_type: "weekly",
  privacy_model: "named",
  status: "open",
  closes_at: "2099-01-01T00:00:00Z",
  retention_days: 365,
  min_group_size: 1,
  question_snapshot: [{
    id: "q1",
    metric_key: "weekly_overall",
    prompt: "How was your work week overall?",
    response_type: "scale",
    options: [{ value: 1, label: "Very difficult" }, { value: 5, label: "Great" }],
    dimension: "experience",
    required: true,
    display_order: 1,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: { response_id: "response-id" }, error: null });
  getSupabaseMock.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: "recipient-id", employee_name: "Alex", opened_at: null, completed_at: null, survey_campaigns: campaign },
            error: null,
          }),
        }),
      }),
    }),
    rpc: rpcMock,
  });
});
function request(answers: unknown[]) {
  return new NextRequest("https://tools.example/api/survey/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

describe("survey submission", () => {
  it("rejects a missing required answer before the atomic database submission", async () => {
    const response = await POST(request([]), { params: Promise.resolve({ token: "token" }) });
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("submits validated typed answers through the atomic RPC", async () => {
    const response = await POST(request([{ metric_key: "weekly_overall", value: 1 }]), { params: Promise.resolve({ token: "token" }) });
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("submit_employee_survey", {
      p_token: "token",
      p_answers: [{ metric_key: "weekly_overall", value: 1 }],
    });
  });
});
