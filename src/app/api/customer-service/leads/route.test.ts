import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  isAuthenticatedMock,
  getSupabaseMock,
  leadRangeMock,
  attachmentRangeMock,
  attemptRangeMock,
  attemptInMock,
} = vi.hoisted(() => ({
  isAuthenticatedMock: vi.fn(),
  getSupabaseMock: vi.fn(),
  leadRangeMock: vi.fn(),
  attachmentRangeMock: vi.fn(),
  attemptRangeMock: vi.fn(),
  attemptInMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  isAuthenticated: isAuthenticatedMock,
  getAuthenticatedUser: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ getSupabase: getSupabaseMock }));

vi.mock("@/lib/customer-service/meta-leads", () => ({
  getMetaConnectionStatus: vi.fn(),
  metaErrorMessage: vi.fn(),
  syncRecentMetaLeads: vi.fn(),
}));

import { GET, PATCH, POST } from "@/app/api/customer-service/leads/route";

function queryBuilder(range: ReturnType<typeof vi.fn>) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range,
    eq: vi.fn(() => builder),
    in: attemptInMock,
  };
  attemptInMock.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticatedMock.mockResolvedValue(true);
  leadRangeMock.mockResolvedValueOnce({
    data: [{
      id: "lead-1",
      source: "website",
      source_detail: "Contact form",
      form_id: null,
      page_url: null,
      name: "Jane",
      email: "jane@example.com",
      phone: "+15145551234",
      message: null,
      installation_requested: true,
      raw_payload: { fields: { internal_form_data: "large private payload" } },
      submitted_at: "2026-08-05T12:00:00.000Z",
      call_status: "called",
      outcome: "contacted",
      quote_number: null,
      quote_amount: null,
      quote_sent_at: null,
      lost_reason: null,
      not_applicable_reason: null,
      notes: null,
      assigned_to: null,
      created_at: "2026-08-05T12:00:00.000Z",
      updated_at: "2026-08-05T13:00:00.000Z",
    }],
    error: null,
  }).mockResolvedValue({ data: [], error: null });
  attemptRangeMock.mockResolvedValueOnce({
    data: [{
      lead_id: "lead-1",
      staff: "Extension 212",
      called_at: "2026-08-05T12:30:00.000Z",
    }],
    error: null,
  }).mockResolvedValue({ data: [], error: null });
  attachmentRangeMock.mockResolvedValueOnce({
    data: [{
      id: "attachment-1",
      lead_id: "lead-1",
      field_name: "file-1",
      filename: "drawing.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
      created_at: "2026-08-05T12:00:01.000Z",
    }],
    error: null,
  }).mockResolvedValue({ data: [], error: null });

  const leadsQuery = queryBuilder(leadRangeMock);
  const attachmentsQuery = queryBuilder(attachmentRangeMock);
  const attemptsQuery = queryBuilder(attemptRangeMock);
  getSupabaseMock.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "leads") return leadsQuery;
      if (table === "lead_attachments") return attachmentsQuery;
      return attemptsQuery;
    }),
  });
});

describe("GET /api/customer-service/leads", () => {
  it("continues pagination after a server-capped partial page", async () => {
    const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(attemptInMock).not.toHaveBeenCalled();
    expect(leadRangeMock).toHaveBeenNthCalledWith(1, 0, 999);
    expect(leadRangeMock).toHaveBeenNthCalledWith(2, 1, 1000);
    expect(attachmentRangeMock).not.toHaveBeenCalled();
    expect(attemptRangeMock).toHaveBeenNthCalledWith(2, 1, 1000);
    expect(body.leads[0]).toMatchObject({
      first_call_at: "2026-08-05T12:30:00.000Z",
      last_call_at: "2026-08-05T12:30:00.000Z",
      last_called_by: "Extension 212",
    });
    expect(body.leads[0].attachments).toBeUndefined();
    expect(body.leads[0].raw_payload).toBeUndefined();
    expect(body.leads[0].call_attempts_count).toBeUndefined();
    expect(body.leads[0].duplicate_ids).toBeUndefined();
  });

  it("loads raw submissions only for the requested lead details", async () => {
    const leadDetailsQuery = {
      select: vi.fn(),
      in: vi.fn(),
    };
    leadDetailsQuery.select.mockReturnValue(leadDetailsQuery);
    leadDetailsQuery.in.mockResolvedValue({
      data: [{ id: "lead-1", raw_payload: { fields: { project: "Railing" } } }],
      error: null,
    });
    const attachmentDetailsQuery = {
      select: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
    };
    attachmentDetailsQuery.select.mockReturnValue(attachmentDetailsQuery);
    attachmentDetailsQuery.in.mockReturnValue(attachmentDetailsQuery);
    attachmentDetailsQuery.order.mockResolvedValue({
      data: [{
        id: "attachment-1",
        lead_id: "lead-1",
        field_name: "file-1",
        filename: "drawing.pdf",
        content_type: "application/pdf",
        size_bytes: 1024,
        created_at: "2026-08-05T12:00:01.000Z",
      }],
      error: null,
    });
    getSupabaseMock.mockReturnValueOnce({
      from: vi.fn((table: string) => (
        table === "leads" ? leadDetailsQuery : attachmentDetailsQuery
      )),
    });

    const response = await GET(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?view=details&lead_ids=lead-1",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      lead_ids: ["lead-1"],
      details: [{
        id: "lead-1",
        raw_payload: { fields: { project: "Railing" } },
        attachments: [expect.objectContaining({
          id: "attachment-1",
          filename: "drawing.pdf",
        })],
      }],
    });
  });
});

describe("PATCH /api/customer-service/leads", () => {
  it("rejects a negative quote amount", async () => {
    const response = await PATCH(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "lead-1", quote_amount: -1 }),
      },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "quote_amount must be a non-negative number",
    });
  });
});

describe("POST /api/customer-service/leads", () => {
  it("does not accept manual call logging", async () => {
    const response = await POST(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?action=log_call",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: "lead-1",
          result: "Called",
        }),
      },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "unknown action" });
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });
});
