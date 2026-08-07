import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      insert: mocks.insert,
      select: () => ({
        order: () => ({ limit: mocks.select }),
      }),
    }),
  }),
}));

import {
  listAssistantPromptVersions,
  recordAssistantPromptVersion,
} from "@/lib/assistant-prompt-versions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assistant prompt versions", () => {
  it("records a version", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    await recordAssistantPromptVersion({ prompt: "Be concise.", actor: "admin@example.com" });

    expect(mocks.insert).toHaveBeenCalledWith({
      prompt: "Be concise.",
      created_by: "admin@example.com",
    });
  });

  it("never throws when recording fails", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "relation does not exist" } });

    await expect(
      recordAssistantPromptVersion({ prompt: "Be concise.", actor: "admin@example.com" }),
    ).resolves.toBeUndefined();
  });

  it("lists versions newest first", async () => {
    const version = {
      id: "v1",
      prompt: "Be concise.",
      created_by: "admin@example.com",
      created_at: "2026-08-07T00:00:00Z",
    };
    mocks.select.mockResolvedValue({ data: [version], error: null });

    await expect(listAssistantPromptVersions()).resolves.toEqual({
      versions: [version],
      tableMissing: false,
    });
  });

  it("reports a missing table instead of throwing", async () => {
    mocks.select.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });

    await expect(listAssistantPromptVersions()).resolves.toEqual({
      versions: [],
      tableMissing: true,
    });
  });
});
