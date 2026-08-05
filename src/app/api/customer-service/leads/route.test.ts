import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  isAuthenticatedMock,
  getSupabaseMock,
  leadRangeMock,
  attemptRangeMock,
  attemptInMock,
} = vi.hoisted(() => ({
  isAuthenticatedMock: vi.fn(),
  getSupabaseMock: vi.fn(),
  leadRangeMock: vi.fn(),
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

import { GET } from "@/app/api/customer-service/leads/route";

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
  leadRangeMock.mockResolvedValue({
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
      raw_payload: {},
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
  });
  attemptRangeMock.mockResolvedValue({
    data: [{
      lead_id: "lead-1",
      staff: "Extension 212",
      called_at: "2026-08-05T12:30:00.000Z",
    }],
    error: null,
  });

  const leadsQuery = queryBuilder(leadRangeMock);
  const attemptsQuery = queryBuilder(attemptRangeMock);
  getSupabaseMock.mockReturnValue({
    from: vi.fn((table: string) => table === "leads" ? leadsQuery : attemptsQuery),
  });
});

describe("GET /api/customer-service/leads", () => {
  it("pages linked attempts without sending every lead ID in one filter", async () => {
    const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(attemptInMock).not.toHaveBeenCalled();
    expect(body.leads[0]).toMatchObject({
      first_call_at: "2026-08-05T12:30:00.000Z",
      last_call_at: "2026-08-05T12:30:00.000Z",
      last_called_by: "Extension 212",
      call_attempts_count: 1,
    });
  });
});
