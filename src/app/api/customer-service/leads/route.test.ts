import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  isAuthenticatedMock,
  getSupabaseMock,
  leadRangeMock,
  attachmentRangeMock,
  attemptRangeMock,
  attemptInMock,
  orMock,
  gteMock,
  ltMock,
} = vi.hoisted(() => ({
  isAuthenticatedMock: vi.fn(),
  getSupabaseMock: vi.fn(),
  leadRangeMock: vi.fn(),
  attachmentRangeMock: vi.fn(),
  attemptRangeMock: vi.fn(),
  attemptInMock: vi.fn(),
  orMock: vi.fn(),
  gteMock: vi.fn(),
  ltMock: vi.fn(),
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

import { getAuthenticatedUser } from "@/lib/admin-auth";
import { revalidateTag } from "next/cache";
vi.mock("next/cache", async (original) => ({ ...await original<typeof import("next/cache")>(), revalidateTag: vi.fn() }));

import { GET, PATCH, POST } from "@/app/api/customer-service/leads/route";

function queryBuilder(range: ReturnType<typeof vi.fn>) {
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    or: vi.fn((value) => { orMock(value); return builder; }),
    range,
    eq: vi.fn(() => builder),
    in: attemptInMock,
    gte: vi.fn((...args: unknown[]) => {
      gteMock(...args);
      return builder;
    }),
    lt: vi.fn((...args: unknown[]) => {
      ltMock(...args);
      return builder;
    }),
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

  it("returns unconsolidated historical cohorts for response performance", async () => {
    const trackingQuery = {
      select: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    };
    trackingQuery.select.mockReturnValue(trackingQuery);
    trackingQuery.order.mockReturnValue(trackingQuery);
    trackingQuery.limit.mockResolvedValue({
      data: [{ call_start: "2025-12-22T16:17:35.000Z" }],
      error: null,
    });
    const leadsQuery = queryBuilder(leadRangeMock);
    const attemptsQuery = queryBuilder(attemptRangeMock);
    getSupabaseMock.mockReturnValueOnce({
      from: vi.fn((table: string) => {
        if (table === "leads") return leadsQuery;
        if (table === "call_records") return trackingQuery;
        return attemptsQuery;
      }),
    });

    const response = await GET(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?view=response_performance&from=2025-09-01&to=2026-08-07",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tracking_started_at).toBe("2025-12-22T16:17:35.000Z");
    expect(trackingQuery.select).toHaveBeenCalledWith("call_start");
    expect(gteMock).toHaveBeenCalledWith("submitted_at", "2025-12-22T16:17:35.000Z");
    expect(gteMock).toHaveBeenCalledWith("called_at", "2025-12-22T16:17:35.000Z");
    expect(body.leads[0]).toMatchObject({
      id: "lead-1",
      submitted_at: "2026-08-05T12:00:00.000Z",
      first_call_at: "2026-08-05T12:30:00.000Z",
    });
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

  it("limits combined call activity to the current lead lifecycle", async () => {
    const callAttemptQuery = {
      select: vi.fn(),
      in: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
    };
    callAttemptQuery.select.mockReturnValue(callAttemptQuery);
    callAttemptQuery.in.mockReturnValue(callAttemptQuery);
    callAttemptQuery.gte.mockReturnValue(callAttemptQuery);
    callAttemptQuery.order.mockResolvedValue({
      data: [{ id: "call-1", lead_id: "lead-1" }],
      error: null,
    });
    getSupabaseMock.mockReturnValueOnce({
      from: vi.fn(() => callAttemptQuery),
    });

    const response = await GET(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?view=call_attempts&lead_ids=lead-1,lead-2&since=2026-08-05T20%3A54%3A49.775Z",
    ));

    expect(response.status).toBe(200);
    expect(callAttemptQuery.in).toHaveBeenCalledWith("lead_id", ["lead-1", "lead-2"]);
    expect(callAttemptQuery.gte).toHaveBeenCalledWith(
      "called_at",
      "2026-08-05T20:54:49.775Z",
    );
    await expect(response.json()).resolves.toEqual({
      attempts: [{ id: "call-1", lead_id: "lead-1" }],
    });
  });

  it("bounds lead and call-attempt scans to the requested history window", async () => {
    const response = await GET(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?from=2026-05-29&to=2026-08-03",
    ));

    expect(response.status).toBe(200);
    expect(gteMock).toHaveBeenCalledWith("submitted_at", "2026-05-29T00:00:00.000Z");
    expect(gteMock).toHaveBeenCalledWith("called_at", "2026-05-29T00:00:00.000Z");
    expect(ltMock).toHaveBeenCalledWith("submitted_at", "2026-08-04T06:00:00.000Z");
  });

  it("rejects an invalid history window before querying the database", async () => {
    const response = await GET(new NextRequest(
      "https://tools.rftransparent.ca/api/customer-service/leads?from=not-a-date&to=2026-08-03",
    ));

    expect(response.status).toBe(400);
    expect(getSupabaseMock).not.toHaveBeenCalled();
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


it("includes open leads outside reporting dates and loads their full call history by lead", async () => {
  // lead-1 was submitted 2026-08-05, before this window, and is still open.
  leadRangeMock.mockReset();
  leadRangeMock
    .mockResolvedValueOnce({ data: [{ id: "lead-1", source: "website", email: "jane@example.com", phone: null, submitted_at: "2026-08-05T12:00:00.000Z", call_status: "called", outcome: "contacted", quote_number: null, not_applicable_reason: null }], error: null })
    .mockResolvedValue({ data: [], error: null });
  attemptRangeMock.mockReset();
  attemptRangeMock
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [{ id: "old-call", lead_id: "lead-1", staff: "Extension 212", called_at: "2026-08-05T12:30:00.000Z" }], error: null })
    .mockResolvedValue({ data: [], error: null });
  const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads?store=rf_transparent&from=2026-09-01&to=2026-09-03&include_open=true"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(orMock).toHaveBeenCalledWith(expect.stringContaining("outcome.in.(new,contacted,quoted),and(submitted_at.gte."));
  expect(gteMock).toHaveBeenCalledWith("called_at", "2026-09-01T00:00:00.000Z");
  expect(attemptInMock).toHaveBeenCalledWith("lead_id", ["lead-1"]);
  expect(body.leads[0]).toMatchObject({ first_call_at: "2026-08-05T12:30:00.000Z", last_called_by: "Extension 212" });
});


it("attributes manual call status to the signed-in user, ignoring client-supplied authors", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ email: "real@example.com" } as NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>);
  const update = vi.fn(() => ({ in: vi.fn(async () => ({ error: null })) }));
  getSupabaseMock.mockReturnValue({ from: vi.fn(() => ({ update })) });
  const response = await PATCH(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads", { method: "PATCH", body: JSON.stringify({ id: "lead-1", call_status: "called", call_status_source: "phone_sync", call_status_changed_by: "forged@example.com" }) }));
  expect(response.status).toBe(200);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ call_status: "called", call_status_source: "manual", call_status_changed_by: "real@example.com", call_status_changed_at: expect.any(String) }));
});
it("rejects a call-status edit when the authenticated employee cannot be identified", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  const response = await PATCH(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads", { method: "PATCH", body: JSON.stringify({ id: "lead-1", call_status: "called" }) }));
  expect(response.status).toBe(401);
  expect(getSupabaseMock).not.toHaveBeenCalled();
});

it("keeps member ids on combined rows and pages leads and calls in a stable order", async () => {
  const base = { source: "website", name: "Jane", email: "jane@example.com", phone: null, call_status: "not_called", outcome: "new", quote_number: null, not_applicable_reason: null };
  leadRangeMock.mockReset();
  leadRangeMock.mockResolvedValueOnce({
    data: [
      { ...base, id: "lead-2", submitted_at: "2026-08-06T12:00:00.000Z" },
      { ...base, id: "lead-1", submitted_at: "2026-08-05T12:00:00.000Z" },
      { ...base, id: "solo", email: "solo@example.com", submitted_at: "2026-08-04T12:00:00.000Z" },
    ],
    error: null,
  }).mockResolvedValue({ data: [], error: null });
  const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads?store=rf_transparent"));
  const body = await response.json();
  const combined = body.leads.find((lead: { duplicate_count?: number }) => lead.duplicate_count === 2);
  expect([...combined.duplicate_ids].sort()).toEqual(["lead-1", "lead-2"]);
  expect(body.leads.find((lead: { email: string }) => lead.email === "solo@example.com").duplicate_ids).toBeUndefined();
  const client = getSupabaseMock.mock.results[0].value;
  expect(client.from("leads").order).toHaveBeenCalledWith("id");
  expect(client.from("lead_call_attempts").order).toHaveBeenCalledWith("id");
});

it("groups lead details only within the lead's own store", async () => {
  const rows = [
    { id: "rf-new", email: "jane@example.com", phone: null, submitted_at: "2026-10-20T12:00:00.000Z", not_applicable_reason: null },
    { id: "rf-repeat", email: "jane@example.com", phone: null, submitted_at: "2026-10-21T12:00:00.000Z", not_applicable_reason: null },
  ];
  const leads: Record<string, ReturnType<typeof vi.fn>> = {};
  Object.assign(leads, {
    select: vi.fn(() => leads),
    eq: vi.fn(() => leads),
    order: vi.fn(() => leads),
    maybeSingle: vi.fn(async () => ({ data: { store_id: "rf_transparent" }, error: null })),
    range: vi.fn(async (from: number) => ({ data: from === 0 ? rows : [], error: null })),
    in: vi.fn(async () => ({ data: [], error: null })),
  });
  const attachments: Record<string, ReturnType<typeof vi.fn>> = {};
  Object.assign(attachments, {
    select: vi.fn(() => attachments),
    in: vi.fn(() => attachments),
    order: vi.fn(async () => ({ data: [], error: null })),
  });
  getSupabaseMock.mockReturnValue({ from: vi.fn((table: string) => table === "leads" ? leads : attachments) });
  const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads?view=details&lead_id=rf-new"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(leads.eq).toHaveBeenCalledWith("id", "rf-new");
  expect(leads.eq).toHaveBeenCalledWith("store_id", "rf_transparent");
  expect([...body.lead_ids].sort()).toEqual(["rf-new", "rf-repeat"]);
});

it("expires the cached lead list immediately after an edit", async () => {
  const update = vi.fn(() => ({ in: vi.fn(async () => ({ error: null })) }));
  getSupabaseMock.mockReturnValue({ from: vi.fn(() => ({ update })) });
  const response = await PATCH(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads", { method: "PATCH", body: JSON.stringify({ id: "lead-1", outcome: "won" }) }));
  expect(response.status).toBe(200);
  expect(revalidateTag).toHaveBeenCalledWith("customer-service:leads", { expire: 0 });
});

it("marks which combined records belong to the current inquiry", async () => {
  const base = { source: "website", name: "Jane", email: "jane@example.com", phone: null, call_status: "not_called", quote_number: null };
  leadRangeMock.mockReset();
  leadRangeMock.mockResolvedValueOnce({
    data: [
      { ...base, id: "new-request", outcome: "new", not_applicable_reason: null, submitted_at: "2026-09-02T12:00:00.000Z" },
      { ...base, id: "repeat", outcome: "new", not_applicable_reason: null, submitted_at: "2026-09-05T12:00:00.000Z" },
      { ...base, id: "imported", outcome: "not_applicable", not_applicable_reason: "Historical Powerful Form Builder record; workflow status unknown", submitted_at: "2025-03-01T12:00:00.000Z" },
    ],
    error: null,
  }).mockResolvedValue({ data: [], error: null });
  const body = await (await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads?store=rf_transparent"))).json();
  expect(body.leads).toHaveLength(1);
  expect([...body.leads[0].duplicate_ids].sort()).toEqual(["imported", "new-request", "repeat"]);
  expect([...body.leads[0].workflow_ids].sort()).toEqual(["new-request", "repeat"]);
  expect(body.leads[0]).toMatchObject({ submitted_at: "2026-09-02T12:00:00.000Z", last_submitted_at: "2026-09-05T12:00:00.000Z" });
});

it("lists only unanswered calls from the lead's number after the lead arrived", async () => {
  const leads: Record<string, ReturnType<typeof vi.fn>> = {};
  Object.assign(leads, { select: vi.fn(() => leads), in: vi.fn(async () => ({ data: [{ phone: "(416) 555-0123" }], error: null })) });
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  Object.assign(calls, {
    select: vi.fn(() => calls), eq: vi.fn(() => calls), or: vi.fn(() => calls), gte: vi.fn(() => calls), order: vi.fn(() => calls),
    limit: vi.fn(async () => ({
      data: [
        { id: "voicemail", store_id: "rf_transparent", call_start: "2026-10-20T15:00:00Z", from_number: "4165550123", direction: "inbound", duration_min: 1, endpoint: "VM 201", source: "cik" },
        { id: "abandoned", store_id: "rf_transparent", call_start: "2026-10-20T14:00:00Z", from_number: "14165550123", direction: "inbound", duration_min: 0, endpoint: null, source: "cik" },
        { id: "answered", store_id: "rf_transparent", call_start: "2026-10-20T13:00:00Z", from_number: "4165550123", direction: "inbound", duration_min: 3, endpoint: "212", source: "cik" },
        { id: "other-number", store_id: "rf_transparent", call_start: "2026-10-20T12:00:00Z", from_number: "9054165550123", direction: "inbound", duration_min: 0, endpoint: null, source: "cik" },
      ],
      error: null,
    })),
  });
  getSupabaseMock.mockReturnValue({ from: vi.fn((table: string) => table === "leads" ? leads : calls) });
  const response = await GET(new NextRequest("https://tools.rftransparent.ca/api/customer-service/leads?view=missed_calls&lead_ids=lead-1&since=2026-10-19T12%3A00%3A00.000Z"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(calls.or).toHaveBeenCalledWith("from_number.ilike.%4165550123");
  expect(calls.gte).toHaveBeenCalledWith("call_start", "2026-10-19T12:00:00.000Z");
  expect(body.calls).toEqual([
    { id: "voicemail", called_at: "2026-10-20T15:00:00Z", store_id: "rf_transparent", voicemail: true },
    { id: "abandoned", called_at: "2026-10-20T14:00:00Z", store_id: "rf_transparent", voicemail: false },
  ]);
});
