import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  getSetting: vi.fn(),
  putSetting: vi.fn(),
  recordSettingChange: vi.fn(),
  listVersions: vi.fn(),
  recordVersion: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/settings", () => ({
  getSetting: mocks.getSetting,
  putSetting: mocks.putSetting,
}));
vi.mock("@/lib/settings-audit", () => ({
  recordSettingChange: mocks.recordSettingChange,
}));
vi.mock("@/lib/assistant-prompt-versions", () => ({
  listAssistantPromptVersions: mocks.listVersions,
  recordAssistantPromptVersion: mocks.recordVersion,
}));

import { GET, PUT } from "@/app/api/settings/assistant-prompt/route";

function request(body: unknown) {
  return new NextRequest("https://tools.rftransparent.ca/api/settings/assistant-prompt", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.getSetting.mockResolvedValue("Stored prompt");
  mocks.putSetting.mockResolvedValue(undefined);
  mocks.recordSettingChange.mockResolvedValue(undefined);
  mocks.listVersions.mockResolvedValue({
    versions: [{ id: "v1", prompt: "Old", created_by: "a@b.c", created_at: "2026-08-01T00:00:00Z" }],
    tableMissing: false,
  });
  mocks.recordVersion.mockResolvedValue(undefined);
});

describe("assistant prompt settings route", () => {
  it("requires authentication", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getSetting).not.toHaveBeenCalled();
  });

  it("returns the current prompt to an administrator", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ initialPrompt: "Stored prompt" });
  });

  it("validates prompt updates", async () => {
    const response = await PUT(request({ initialPrompt: "   " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Initial prompt is required" });
    expect(mocks.putSetting).not.toHaveBeenCalled();
  });

  it("saves a trimmed prompt and records the change", async () => {
    const response = await PUT(request({ initialPrompt: "  Keep answers concise.  " }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ initialPrompt: "Keep answers concise." });
    expect(mocks.putSetting).toHaveBeenCalledWith(
      "assistant_initial_prompt",
      "Keep answers concise.",
    );
    expect(mocks.recordSettingChange).toHaveBeenCalledWith({
      area: "assistant",
      actor: "admin@example.com",
      summary: "Updated the assistant initial prompt",
    });
    expect(mocks.recordVersion).toHaveBeenCalledWith({
      prompt: "Keep answers concise.",
      actor: "admin@example.com",
    });
  });

  it("captures the replaced prompt as the first version", async () => {
    mocks.listVersions.mockResolvedValue({ versions: [], tableMissing: false });

    await PUT(request({ initialPrompt: "New prompt" }));

    expect(mocks.recordVersion).toHaveBeenNthCalledWith(1, {
      prompt: "Stored prompt",
      actor: "system (pre-history)",
    });
    expect(mocks.recordVersion).toHaveBeenNthCalledWith(2, {
      prompt: "New prompt",
      actor: "admin@example.com",
    });
  });

  it("skips the bootstrap version when the table is missing", async () => {
    mocks.listVersions.mockResolvedValue({ versions: [], tableMissing: true });

    const response = await PUT(request({ initialPrompt: "New prompt" }));

    expect(response.status).toBe(200);
    expect(mocks.recordVersion).toHaveBeenCalledTimes(1);
    expect(mocks.recordVersion).toHaveBeenCalledWith({
      prompt: "New prompt",
      actor: "admin@example.com",
    });
  });
});
