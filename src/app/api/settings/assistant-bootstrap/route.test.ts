import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminEmail: vi.fn(),
  getInitialPrompt: vi.fn(),
  listEvaluations: vi.fn(),
  listGaps: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/authz", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));
vi.mock("@/lib/assistant-prompt", () => ({
  getAssistantInitialPrompt: mocks.getInitialPrompt,
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  listAssistantEvaluationCases: mocks.listEvaluations,
  listAssistantKnowledgeGaps: mocks.listGaps,
}));

import { GET } from "@/app/api/settings/assistant-bootstrap/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminEmail.mockResolvedValue(true);
  mocks.getInitialPrompt.mockResolvedValue("Assistant prompt");
  mocks.listEvaluations.mockResolvedValue([{ id: "case-1" }]);
  mocks.listGaps.mockResolvedValue({
    gaps: [{ id: "gap-1" }],
    statusSupported: true,
  });
});

describe("assistant settings bootstrap", () => {
  it("requires an authenticated administrator", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getInitialPrompt).not.toHaveBeenCalled();
  });

  it("loads hidden-tab data together", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      initialPrompt: "Assistant prompt",
      evaluations: [{ id: "case-1" }],
      gaps: [{ id: "gap-1" }],
      gapStatusSupported: true,
    });
    expect(mocks.getInitialPrompt).toHaveBeenCalledOnce();
    expect(mocks.listEvaluations).toHaveBeenCalledOnce();
    expect(mocks.listGaps).toHaveBeenCalledOnce();
  });
});
