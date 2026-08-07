import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseMock = vi.fn();
const searchAssistantKnowledgeMock = vi.fn();
const getAssistantInitialPromptMock = vi.fn();
const recordAssistantKnowledgeQueryMock = vi.fn();
const rewriteAssistantRetrievalQueryMock = vi.fn();
const listAssistantKnowledgeForContextMock = vi.fn();
const isSmalltalkMessageMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  searchAssistantKnowledge: (...args: unknown[]) => searchAssistantKnowledgeMock(...args),
  recordAssistantKnowledgeQuery: (...args: unknown[]) => recordAssistantKnowledgeQueryMock(...args),
  listAssistantKnowledgeForContext: (...args: unknown[]) => listAssistantKnowledgeForContextMock(...args),
}));
vi.mock("@/lib/assistant-prompt", () => ({
  getAssistantInitialPrompt: () => getAssistantInitialPromptMock(),
}));
vi.mock("@/lib/assistant-retrieval", () => ({
  rewriteAssistantRetrievalQuery: (...args: unknown[]) => rewriteAssistantRetrievalQueryMock(...args),
  isSmalltalkMessage: (...args: unknown[]) => isSmalltalkMessageMock(...args),
  formatAssistantKnowledgeContext: (entries: Array<{ title: string; content: string }>) =>
    entries.map((entry) => `${entry.title}: ${entry.content}`).join("\n"),
}));

import { POST } from "@/app/api/internal/whatsapp/employee-context/route";

const employeeResultMock = vi.fn();
const surveyResultMock = vi.fn();

function createRequest(body: unknown, authorization = "Bearer shared-secret") {
  return new Request("https://tools.rftransparent.ca/api/internal/whatsapp/employee-context", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_ASSISTANT_SHARED_SECRET = "shared-secret";
  delete process.env.NEXT_PUBLIC_APP_URL;

  const employeeQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    overrideTypes: employeeResultMock,
  };
  employeeQuery.select.mockReturnValue(employeeQuery);
  employeeQuery.eq.mockReturnValue(employeeQuery);
  employeeQuery.not.mockReturnValue(employeeQuery);

  const surveyQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: surveyResultMock,
  };
  surveyQuery.select.mockReturnValue(surveyQuery);
  surveyQuery.eq.mockReturnValue(surveyQuery);
  surveyQuery.order.mockReturnValue(surveyQuery);
  surveyQuery.limit.mockReturnValue(surveyQuery);

  const from = vi.fn((table: string) => {
    if (table === "employees") return employeeQuery;
    if (table === "employee_surveys") return surveyQuery;
    throw new Error(`Unexpected table: ${table}`);
  });

  getSupabaseMock.mockReturnValue({ from });
  employeeResultMock.mockResolvedValue({ data: [], error: null });
  surveyResultMock.mockResolvedValue({ data: null, error: null });
  searchAssistantKnowledgeMock.mockResolvedValue([]);
  getAssistantInitialPromptMock.mockResolvedValue("Custom initial prompt");
  recordAssistantKnowledgeQueryMock.mockResolvedValue(undefined);
  rewriteAssistantRetrievalQueryMock.mockImplementation(({ message }) => Promise.resolve(message));
  listAssistantKnowledgeForContextMock.mockResolvedValue([]);
  isSmalltalkMessageMock.mockReturnValue(false);
});

describe("POST /api/internal/whatsapp/employee-context", () => {
  it("rejects requests without the shared bearer secret", async () => {
    const response = await POST(createRequest({ phone: "+14166134388" }, "Bearer wrong"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });

  it("rejects invalid phone numbers before querying Supabase", async () => {
    const response = await POST(createRequest({ phone: "555" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid phone number is required" });
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });

  it("returns empty context when no active employee phone matches", async () => {
    employeeResultMock.mockResolvedValueOnce({
      data: [
        {
          id: "employee-1",
          name: "Alex",
          department: "Sales",
          phone: "+1 416 555 0100",
          locations: { name: "Toronto" },
        },
      ],
      error: null,
    });

    const response = await POST(createRequest({ phone: "+1 416 555 0199" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contractVersion: 2,
      initialPrompt: "Custom initial prompt",
      employee: null,
      survey: null,
      knowledge: [],
      knowledgeContext: "",
      retrieval: { query: "", mode: "compatibility", matched: false, citations: [] },
    });
    expect(surveyResultMock).not.toHaveBeenCalled();
  });

  it("returns published answers when a legacy caller omits the message", async () => {
    const publishedAnswer = {
      id: "knowledge-1",
      title: "Company creation",
      content: "RF Transparent was created in 2015.",
      category: "company",
      department: null,
      location: null,
      keywords: ["created", "founded", "2015"],
      source_id: null,
      source_title: null,
      source_excerpt: null,
      rank: 0,
    };
    listAssistantKnowledgeForContextMock.mockResolvedValueOnce([publishedAnswer]);

    const response = await POST(createRequest({ phone: "+1 999 999 9999" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contractVersion: 2,
      initialPrompt: "Custom initial prompt",
      employee: null,
      survey: null,
      knowledge: [publishedAnswer],
      knowledgeContext: "Company creation: RF Transparent was created in 2015.",
      retrieval: {
        query: "",
        mode: "compatibility",
        matched: true,
        citations: [{
          knowledgeId: "knowledge-1",
          title: "Company creation",
          sourceId: null,
          sourceTitle: null,
        }],
      },
    });
    expect(listAssistantKnowledgeForContextMock).toHaveBeenCalledWith({
      department: null,
      location: null,
    });
    expect(searchAssistantKnowledgeMock).not.toHaveBeenCalled();
  });

  it("returns matched employee context and the latest pending survey link", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://internal.example.com/";
    employeeResultMock.mockResolvedValueOnce({
      data: [
        {
          id: "employee-1",
          name: "Alex",
          department: "Sales",
          phone: "+1 (416) 613-4388",
          locations: { name: "Toronto" },
        },
      ],
      error: null,
    });
    surveyResultMock.mockResolvedValueOnce({
      data: {
        token: "survey-token",
        week_of: "2026-08-03",
        responded_at: null,
        created_at: "2026-08-03T12:00:00Z",
      },
      error: null,
    });

    searchAssistantKnowledgeMock.mockResolvedValueOnce([
      {
        id: "knowledge-1",
        title: "Submitting invoices",
        content: "Send the invoice photo in this WhatsApp chat.",
        category: "invoices",
        department: null,
        location: null,
        keywords: ["invoice"],
        source_id: null,
        source_title: null,
        source_excerpt: null,
        rank: 0.7,
      },
    ]);

    const response = await POST(createRequest({
      phone: "14166134388",
      message: "How do I submit an invoice?",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      contractVersion: 2,
      initialPrompt: "Custom initial prompt",
      employee: {
        id: "employee-1",
        name: "Alex",
        department: "Sales",
        location: "Toronto",
      },
      survey: {
        weekOf: "2026-08-03",
        completed: false,
        link: "https://internal.example.com/survey/survey-token",
      },
      knowledge: [
        {
          id: "knowledge-1",
          title: "Submitting invoices",
          content: "Send the invoice photo in this WhatsApp chat.",
          category: "invoices",
          department: null,
          location: null,
          keywords: ["invoice"],
          source_id: null,
          source_title: null,
          source_excerpt: null,
          rank: 0.7,
        },
      ],
      knowledgeContext: "Submitting invoices: Send the invoice photo in this WhatsApp chat.",
      retrieval: {
        query: "How do I submit an invoice?",
        mode: "hybrid",
        matched: true,
        citations: [{
          knowledgeId: "knowledge-1",
          title: "Submitting invoices",
          sourceId: null,
          sourceTitle: null,
        }],
      },
    });
    expect(searchAssistantKnowledgeMock).toHaveBeenCalledWith(
      "How do I submit an invoice?",
      { department: "Sales", location: "Toronto" },
    );
    expect(recordAssistantKnowledgeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "employee-1",
      message: "How do I submit an invoice?",
    }));
  });

  it("does not expose a link for a completed survey", async () => {
    employeeResultMock.mockResolvedValueOnce({
      data: [
        {
          id: "employee-1",
          name: "Alex",
          department: null,
          phone: "14166134388",
          locations: null,
        },
      ],
      error: null,
    });
    surveyResultMock.mockResolvedValueOnce({
      data: {
        token: "survey-token",
        week_of: "2026-08-03",
        responded_at: "2026-08-04T12:00:00Z",
        created_at: "2026-08-03T12:00:00Z",
      },
      error: null,
    });

    const response = await POST(createRequest({ phone: "+1 416 613 4388" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.employee.location).toBeNull();
    expect(body.survey).toEqual({
      weekOf: "2026-08-03",
      completed: true,
      link: null,
    });
    expect(body.knowledge).toEqual([]);
    expect(body.knowledgeContext).toBe("");
    expect(body.retrieval).toEqual({
      query: "",
      mode: "compatibility",
      matched: false,
      citations: [],
    });
    expect(body.contractVersion).toBe(2);
    expect(body.initialPrompt).toBe("Custom initial prompt");
  });

  it("skips retrieval and gap logging for smalltalk messages", async () => {
    isSmalltalkMessageMock.mockReturnValue(true);
    employeeResultMock.mockResolvedValueOnce({
      data: [
        {
          id: "employee-1",
          name: "Alex",
          department: "Sales",
          phone: "+1 416 555 0100",
          locations: { name: "Toronto" },
        },
      ],
      error: null,
    });

    const response = await POST(createRequest({ phone: "+1 416 555 0100", message: "hey" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(isSmalltalkMessageMock).toHaveBeenCalledWith("hey");
    expect(rewriteAssistantRetrievalQueryMock).not.toHaveBeenCalled();
    expect(searchAssistantKnowledgeMock).not.toHaveBeenCalled();
    expect(recordAssistantKnowledgeQueryMock).not.toHaveBeenCalled();
    expect(body.retrieval).toEqual({
      query: "",
      mode: "smalltalk",
      matched: false,
      citations: [],
    });
    expect(body.knowledge).toEqual([]);
  });

  it("returns a controlled error when employee lookup fails", async () => {
    employeeResultMock.mockResolvedValueOnce({ data: null, error: { message: "database down" } });

    const response = await POST(createRequest({ phone: "+1 416 613 4388" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Employee lookup failed" });
  });
});
