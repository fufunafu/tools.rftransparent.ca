import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  putSetting: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getSetting: mocks.getSetting,
  putSetting: mocks.putSetting,
}));

import {
  DEFAULT_ASSISTANT_INITIAL_PROMPT,
  getAssistantInitialPrompt,
  putAssistantInitialPrompt,
} from "@/lib/assistant-prompt";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assistant initial prompt", () => {
  it("uses the stored prompt", async () => {
    mocks.getSetting.mockResolvedValue("Use approved answers only.");

    await expect(getAssistantInitialPrompt()).resolves.toBe("Use approved answers only.");
  });

  it("falls back when the stored value is invalid", async () => {
    mocks.getSetting.mockResolvedValue("   ");

    await expect(getAssistantInitialPrompt()).resolves.toBe(DEFAULT_ASSISTANT_INITIAL_PROMPT);
  });

  it("trims and persists an updated prompt", async () => {
    mocks.putSetting.mockResolvedValue(undefined);

    await expect(putAssistantInitialPrompt("  Keep replies concise.  ")).resolves.toBe(
      "Keep replies concise.",
    );
    expect(mocks.putSetting).toHaveBeenCalledWith(
      "assistant_initial_prompt",
      "Keep replies concise.",
    );
  });

  it("rejects an empty prompt", async () => {
    await expect(putAssistantInitialPrompt("   ")).rejects.toThrow("Initial prompt is required");
    expect(mocks.putSetting).not.toHaveBeenCalled();
  });
});
