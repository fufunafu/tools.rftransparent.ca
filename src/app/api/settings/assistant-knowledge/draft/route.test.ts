import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
  generateDraft: vi.fn(),
  employeeResult: vi.fn(),
  locationResult: vi.fn(),
  saveSource: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  isAdminUser: mocks.isAdminUser,
}));
vi.mock("@/lib/assistant-knowledge-draft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-knowledge-draft")>();
  return { ...actual, generateAssistantKnowledgeDraft: mocks.generateDraft };
});
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => {
    const employeeQuery = {
      select: vi.fn(),
      not: mocks.employeeResult,
    };
    employeeQuery.select.mockReturnValue(employeeQuery);
    const locationQuery = {
      select: vi.fn(),
      order: mocks.locationResult,
    };
    locationQuery.select.mockReturnValue(locationQuery);
    return {
      from: (table: string) => table === "employees" ? employeeQuery : locationQuery,
    };
  },
}));
vi.mock("@/lib/assistant-knowledge-source", () => ({
  saveAssistantKnowledgeSource: mocks.saveSource,
}));

import { POST } from "@/app/api/settings/assistant-knowledge/draft/route";

function request(source: unknown, extra: Record<string, unknown> = {}) {
  return new NextRequest(
    "https://tools.rftransparent.ca/api/settings/assistant-knowledge/draft",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, ...extra }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({
    id: "user-1",
    email: "admin@example.com",
  });
  mocks.isAdminUser.mockResolvedValue(true);
  mocks.employeeResult.mockResolvedValue({
    data: [
      { department: "Sales" },
      { department: "Accounting" },
      { department: "Sales" },
    ],
  });
  mocks.locationResult.mockResolvedValue({
    data: [{ name: "Toronto" }, { name: "Montreal" }],
  });
  mocks.generateDraft.mockResolvedValue({
    publishable: true,
    reviewNote: "Ready for review",
    drafts: [{
        title: "How do I submit a receipt?",
        content: "Send it in WhatsApp.",
        category: "expenses",
        department: "",
        location: "",
        keywords: ["receipt"],
        source_excerpt: "Send it in WhatsApp.",
        active: true,
      },
      {
        title: "Who approves receipts?",
        content: "Accounting approves receipts.",
        category: "expenses",
        department: "",
        location: "",
        keywords: ["approve", "accounting"],
        source_excerpt: "Accounting approves receipts.",
        active: true,
      }],
    model: "gpt-5.6-luna",
  });
  mocks.saveSource.mockResolvedValue("00000000-0000-4000-8000-000000000301");
});

describe("assistant knowledge AI draft route", () => {
  it("requires an authenticated administrator", async () => {
    mocks.getAuthenticatedUser.mockResolvedValueOnce(null);

    const response = await POST(request("Policy note"));

    expect(response.status).toBe(401);
    expect(mocks.generateDraft).not.toHaveBeenCalled();
  });

  it("rejects an empty source before calling the model", async () => {
    const response = await POST(request("   "));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Paste notes or an email first" });
    expect(mocks.generateDraft).not.toHaveBeenCalled();
  });

  it("generates a draft with trusted scope options", async () => {
    const response = await POST(request("  Approved receipt procedure  "));

    expect(response.status).toBe(200);
    expect(mocks.generateDraft).toHaveBeenCalledWith({
      source: "Approved receipt procedure",
      refinement: "",
      currentDrafts: [],
      departments: ["Accounting", "Sales"],
      locations: ["Toronto", "Montreal"],
      safetyIdentifier: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const body = await response.json();
    expect(body.sourceId).toBe("00000000-0000-4000-8000-000000000301");
    expect(body.drafts).toHaveLength(2);
    expect(body.drafts[0].source_id).toBe(body.sourceId);
    expect(mocks.saveSource).toHaveBeenCalledWith(expect.objectContaining({
      title: "How do I submit a receipt?",
      sourceKind: "text",
      content: "Approved receipt procedure",
      actor: "admin@example.com",
    }));
  });

  it("returns a review reason instead of an unsuitable draft", async () => {
    mocks.generateDraft.mockResolvedValueOnce({
      publishable: false,
      reviewNote: "The email does not contain an approved answer.",
      drafts: [],
      model: "gpt-5.6-luna",
    });

    const response = await POST(request("Unclear email"));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "The email does not contain an approved answer.",
      model: "gpt-5.6-luna",
    });
  });

  it("passes a follow-up instruction and current draft to the model", async () => {
    const currentDraft = {
      title: "How do I submit a receipt?",
      content: "Send it in WhatsApp.",
      category: "expenses",
      department: "",
      location: "",
      keywords: ["receipt"],
      active: true,
    };

    const response = await POST(request("Approved receipt procedure", {
      refinement: "Limit this answer to Accounting.",
      currentDrafts: [currentDraft],
    }));

    expect(response.status).toBe(200);
    expect(mocks.generateDraft).toHaveBeenCalledWith(expect.objectContaining({
      source: "Approved receipt procedure",
      refinement: "Limit this answer to Accounting.",
      currentDrafts: [{
        ...currentDraft,
        department: null,
        location: null,
      }],
    }));
  });
});
