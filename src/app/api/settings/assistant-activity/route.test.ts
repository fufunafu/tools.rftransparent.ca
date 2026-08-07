import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminEmail: vi.fn(),
  listActivity: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/lib/authz", () => ({
  isAdminEmail: mocks.isAdminEmail,
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  listAssistantActivity: mocks.listActivity,
}));

import { GET } from "@/app/api/settings/assistant-activity/route";

function request(params = "") {
  return new NextRequest(`https://tools.rftransparent.ca/api/settings/assistant-activity${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ email: "admin@example.com" });
  mocks.isAdminEmail.mockResolvedValue(true);
  mocks.listActivity.mockResolvedValue({ queries: [], usage: [] });
});

describe("assistant activity route", () => {
  it("requires an administrator", async () => {
    mocks.isAdminEmail.mockResolvedValueOnce(false);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.listActivity).not.toHaveBeenCalled();
  });

  it("passes filters through", async () => {
    const response = await GET(request("?days=7&department=Sales&matched=no"));

    expect(response.status).toBe(200);
    expect(mocks.listActivity).toHaveBeenCalledWith({
      days: 7,
      department: "Sales",
      matched: false,
    });
  });

  it("defaults to 30 days, all departments, both outcomes", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ queries: [], usage: [] });
    expect(mocks.listActivity).toHaveBeenCalledWith({
      days: 30,
      department: null,
      matched: null,
    });
  });
});
