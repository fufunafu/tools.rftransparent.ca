import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseMock = vi.fn();
const searchAssistantKnowledgeMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => getSupabaseMock(),
}));
vi.mock("@/lib/assistant-knowledge", () => ({
  searchAssistantKnowledge: (...args: unknown[]) => searchAssistantKnowledgeMock(...args),
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
    expect(await response.json()).toEqual({ employee: null, survey: null, knowledge: [] });
    expect(surveyResultMock).not.toHaveBeenCalled();
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
        rank: 0.7,
      },
    ]);

    const response = await POST(createRequest({
      phone: "14166134388",
      message: "How do I submit an invoice?",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
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
          rank: 0.7,
        },
      ],
    });
    expect(searchAssistantKnowledgeMock).toHaveBeenCalledWith(
      "How do I submit an invoice?",
      { department: "Sales", location: "Toronto" },
    );
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
  });

  it("returns a controlled error when employee lookup fails", async () => {
    employeeResultMock.mockResolvedValueOnce({ data: null, error: { message: "database down" } });

    const response = await POST(createRequest({ phone: "+1 416 613 4388" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Employee lookup failed" });
  });
});
