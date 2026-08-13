import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabaseMock, sendWhatsAppSurveyMock, recipientUpsertMock, recipientUpdateMock } = vi.hoisted(() => ({
  getSupabaseMock: vi.fn(),
  sendWhatsAppSurveyMock: vi.fn(),
  recipientUpsertMock: vi.fn(),
  recipientUpdateMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ getSupabase: getSupabaseMock }));
vi.mock("@/lib/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp")>();
  return {
    ...actual,
    assertWhatsAppConfigured: vi.fn(),
    sendWhatsAppSurvey: sendWhatsAppSurveyMock,
  };
});

import { sendSurveys } from "@/lib/employee-surveys";

const template = {
  id: "template-id",
  slug: "weekly-pulse",
  name: "Weekly pulse",
  survey_type: "weekly",
  purpose: "Find support problems.",
  privacy_model: "named",
  estimated_minutes: 2,
  retention_days: 365,
  min_group_size: 1,
};

const questions = [{
  id: "question-id",
  template_id: "template-id",
  metric_key: "weekly_overall",
  prompt: "How was your work week overall?",
  response_type: "scale",
  options: [{ value: 1, label: "Very difficult" }, { value: 5, label: "Great" }],
  dimension: "weekly_experience",
  required: true,
  display_order: 1,
  active: true,
}];

function surveyDatabase(employees: Array<{ id: string; name: string; phone: string; department?: string; location_id?: string | null; email?: string | null }>) {
  const recipientRows = employees.map((employee, index) => ({
    id: `recipient-${index}`,
    campaign_id: "campaign-id",
    employee_id: employee.id,
    token: `token-${index}`,
    employee_name: employee.name,
    phone_snapshot: employee.phone,
    delivery_status: "pending",
    sent_at: null,
    reminder_sent_at: null,
    completed_at: null,
  }));
  return {
    from(table: string) {
      if (table === "employees") {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: employees, error: null }) }),
          }),
        };
      }
      if (table === "survey_campaigns") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "campaign-id",
                  template_slug: "weekly-pulse",
                  survey_type: "weekly",
                  name: "Weekly pulse",
                  purpose: "Find support problems.",
                  privacy_model: "named",
                  status: "open",
                  question_snapshot: questions,
                  send_at: new Date().toISOString(),
                  closes_at: new Date(Date.now() + 86_400_000).toISOString(),
                  reminder_at: new Date(Date.now() + 43_200_000).toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "survey_templates") {
        return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: template, error: null }) }) }) }) };
      }
      if (table === "survey_questions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: questions, error: null }) }) }) }) };
      }
      if (table === "survey_recipients") {
        return {
          upsert: recipientUpsertMock,
          select: () => ({ eq: () => ({ order: async () => ({ data: recipientRows, error: null }) }) }),
          update: recipientUpdateMock,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tools.example");
  delete process.env.WHATSAPP_TEST_RECIPIENT;
  delete process.env.WHATSAPP_TEST_EMPLOYEE_ID;
  recipientUpsertMock.mockResolvedValue({ error: null });
  recipientUpdateMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  sendWhatsAppSurveyMock.mockResolvedValue({ messageId: "wamid.test" });
});

describe("sendSurveys", () => {
  it("tracks an invalid recipient as a failed delivery without sending", async () => {
    getSupabaseMock.mockReturnValue(surveyDatabase([
      { id: "bad", name: "Invalid Employee", phone: "416-555-0123" },
    ]));

    const result = await sendSurveys();

    expect(result).toEqual({
      sent: 0,
      skipped: 0,
      errors: ["Invalid Employee (invalid WhatsApp phone): Enter an international WhatsApp number, such as +1 514 555 0000."],
    });
    expect(recipientUpsertMock).toHaveBeenCalledOnce();
    expect(recipientUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ delivery_status: "failed" }));
    expect(sendWhatsAppSurveyMock).not.toHaveBeenCalled();
  });

  it("continues sending to valid recipients when another phone is invalid", async () => {
    getSupabaseMock.mockReturnValue(surveyDatabase([
      { id: "bad", name: "Invalid Employee", phone: "416-555-0123" },
      { id: "good", name: "Valid Employee", phone: "+1 (416) 555-0123" },
    ]));

    const result = await sendSurveys();

    expect(result.sent).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(sendWhatsAppSurveyMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+14165550123", employeeName: "Valid Employee" }),
    );
  });
});
