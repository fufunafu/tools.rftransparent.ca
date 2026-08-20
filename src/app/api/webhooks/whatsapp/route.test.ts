import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSupabaseMock, updateMock } = vi.hoisted(() => ({
  getSupabaseMock: vi.fn(),
  updateMock: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabase: getSupabaseMock }));

import { POST } from "@/app/api/webhooks/whatsapp/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHATSAPP_APP_SECRET", "webhook-secret");
  updateMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  getSupabaseMock.mockReturnValue({
    from: () => ({
      select: () => ({
        or: () => ({ maybeSingle: async () => ({ data: { id: "recipient-id", delivery_status: "sent", completed_at: null, opened_at: null }, error: null }) }),
      }),
      update: updateMock,
    }),
  });
});
function statusRequest(signatureValid: boolean) {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.123", status: "delivered", timestamp: "1786636800" }] } }] }],
  });
  const signature = createHmac("sha256", signatureValid ? "webhook-secret" : "wrong-secret").update(body).digest("hex");
  return new NextRequest("https://tools.example/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body,
  });
}

describe("WhatsApp delivery webhook", () => {
  it("rejects a payload with an invalid Meta signature", async () => {
    const response = await POST(statusRequest(false));
    expect(response.status).toBe(401);
    expect(getSupabaseMock).not.toHaveBeenCalled();
  });

  it("records delivered status by provider message id", async () => {
    const response = await POST(statusRequest(true));
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      delivery_status: "delivered",
      delivered_at: expect.any(String),
    }));
  });

  it("records birthday-message delivery when the message is not a survey or employee update", async () => {
    getSupabaseMock.mockReturnValue({
      from: (table: string) => {
        if (table === "survey_recipients") {
          return {
            select: () => ({
              or: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        if (table === "survey_action_deliveries") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        if (table === "birthday_message_deliveries") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: "birthday-delivery", status: "sent" }, error: null }) }),
            }),
            update: updateMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const response = await POST(statusRequest(true));
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "delivered",
      delivered_at: expect.any(String),
    }));
  });
});
