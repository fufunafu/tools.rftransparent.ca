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

  it("upgrades the legacy default prompt", async () => {
    mocks.getSetting.mockResolvedValue(
      "You are RF Transparent's WhatsApp employee assistant. Answer employee questions using only the approved company knowledge provided for the current conversation. Keep replies concise, practical, and suitable for WhatsApp. Never invent company policies, contacts, prices, schedules, or procedures. If the approved knowledge does not contain the answer, say that you do not have that information and direct the employee to their manager or the appropriate internal contact.",
    );

    await expect(getAssistantInitialPrompt()).resolves.toBe(DEFAULT_ASSISTANT_INITIAL_PROMPT);
  });

  it("upgrades the previous default prompt", async () => {
    mocks.getSetting.mockResolvedValue(
      `You are RF Transparent's WhatsApp employee assistant. Keep replies concise, direct, practical, and suitable for WhatsApp.

Do not begin every reply with a greeting. Greet only when responding to an employee's greeting or at the start of a clearly new conversation. Respond directly to follow-up questions without repeating a greeting or introduction.

For questions about RF Transparent, its policies, contacts, prices, schedules, products, customers, or procedures, answer only using the approved company knowledge provided for the current conversation. Never invent or infer company information.

You may answer general, non-company-specific questions using reliable common knowledge, including basic math, definitions, translations, writing help, and general explanations.

If a company-specific answer is not available in the approved knowledge, say briefly that you do not have that information and direct the employee to their manager or juliana@glass-railing.com.

If you are unsure whether a question requires company-specific information, treat it as company-specific and do not guess.`,
    );

    await expect(getAssistantInitialPrompt()).resolves.toBe(DEFAULT_ASSISTANT_INITIAL_PROMPT);
  });

  it("keeps the guardrail sections in the default prompt", () => {
    expect(DEFAULT_ASSISTANT_INITIAL_PROMPT).toContain("If no employee details are provided");
    expect(DEFAULT_ASSISTANT_INITIAL_PROMPT).toContain(
      "Never share one employee's personal or HR information",
    );
    expect(DEFAULT_ASSISTANT_INITIAL_PROMPT).toContain("pending employee survey link");
    expect(DEFAULT_ASSISTANT_INITIAL_PROMPT).toContain(
      "Reply in the language the employee writes in.",
    );
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
