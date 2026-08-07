import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  listGaps: vi.fn(),
  updateGapStatus: vi.fn(),
  recordSettingChange: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  listAssistantKnowledgeGaps: mocks.listGaps,
  updateAssistantKnowledgeGapStatus: mocks.updateGapStatus,
}));
vi.mock("@/lib/settings-audit", () => ({
  recordSettingChange: mocks.recordSettingChange,
}));

import { GET, PATCH } from "@/app/api/settings/assistant-gaps/route";

function patchRequest(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/settings/assistant-gaps", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const gapId = "00000000-0000-4000-8000-000000000301";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.listGaps.mockResolvedValue({ gaps: [], statusSupported: true });
  mocks.updateGapStatus.mockResolvedValue(undefined);
  mocks.recordSettingChange.mockResolvedValue(undefined);
});

describe("assistant gaps route", () => {
  it("requires an administrator", async () => {
    mocks.isAdminUser.mockResolvedValueOnce(false);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.listGaps).not.toHaveBeenCalled();
  });

  it("returns gaps with the migration flag", async () => {
    mocks.listGaps.mockResolvedValue({ gaps: [{ id: gapId }], statusSupported: false });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      gaps: [{ id: gapId }],
      statusSupported: false,
    });
  });

  it("validates gap updates", async () => {
    const response = await PATCH(patchRequest({ ids: [], status: "dismissed" }));

    expect(response.status).toBe(400);
    expect(mocks.updateGapStatus).not.toHaveBeenCalled();
  });

  it("dismisses a gap and records the change", async () => {
    const response = await PATCH(patchRequest({
      ids: [gapId],
      status: "dismissed",
      message: "How do I book vacation?",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateGapStatus).toHaveBeenCalledWith({
      ids: [gapId],
      status: "dismissed",
      actor: "admin@example.com",
      knowledgeId: null,
    });
    expect(mocks.recordSettingChange).toHaveBeenCalledWith({
      area: "assistant",
      actor: "admin@example.com",
      summary: 'Dismissed assistant gap: "How do I book vacation?"',
    });
  });

  it("returns 409 when the migration is missing", async () => {
    mocks.updateGapStatus.mockRejectedValue(
      new Error("Gap status requires the assistant_gap_status migration to be applied"),
    );

    const response = await PATCH(patchRequest({ ids: [gapId], status: "dismissed" }));

    expect(response.status).toBe(409);
    expect(mocks.recordSettingChange).not.toHaveBeenCalled();
  });
});
