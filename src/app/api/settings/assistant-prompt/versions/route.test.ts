import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  listVersions: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/assistant-prompt-versions", () => ({
  listAssistantPromptVersions: mocks.listVersions,
}));

import { GET } from "@/app/api/settings/assistant-prompt/versions/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.listVersions.mockResolvedValue({
    versions: [{ id: "v1", prompt: "Be concise.", created_by: "admin@example.com", created_at: "2026-08-07T00:00:00Z" }],
    tableMissing: false,
  });
});

describe("assistant prompt versions route", () => {
  it("requires authentication", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.listVersions).not.toHaveBeenCalled();
  });

  it("requires an administrator", async () => {
    mocks.isAdminUser.mockResolvedValueOnce(false);

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("returns versions and the migration flag", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      versions: [{
        id: "v1",
        prompt: "Be concise.",
        created_by: "admin@example.com",
        created_at: "2026-08-07T00:00:00Z",
      }],
      tableMissing: false,
    });
  });
});
