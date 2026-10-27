import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertWhatsAppConfigured,
  checkWhatsAppConnection,
  normalizeWhatsAppNumber,
  sendWhatsAppBirthdayGreeting,
  sendWhatsAppBirthdayReminder,
  sendWhatsAppSurvey,
} from "@/lib/whatsapp";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ENV_KEYS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_SURVEY_TEMPLATE_NAME",
  "WHATSAPP_BIRTHDAY_GREETING_TEMPLATE_NAME",
  "WHATSAPP_BIRTHDAY_REMINDER_TEMPLATE_NAME",
  "WHATSAPP_TEMPLATE_LANGUAGE",
] as const;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_GRAPH_API_VERSION = "v24.0";
  process.env.WHATSAPP_SURVEY_TEMPLATE_NAME = "weekly_checkin";
  process.env.WHATSAPP_BIRTHDAY_GREETING_TEMPLATE_NAME = "employee_birthday_greeting";
  process.env.WHATSAPP_BIRTHDAY_REMINDER_TEMPLATE_NAME = "employee_birthday_reminder";
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("normalizeWhatsAppNumber", () => {
  it("normalizes international numbers to Meta's digits-only format", () => {
    expect(normalizeWhatsAppNumber("+1 (416) 555-0123")).toBe("14165550123");
  });

  it("rejects invalid phone numbers", () => {
    expect(() => normalizeWhatsAppNumber("416-555")).toThrow(
      "international WhatsApp number",
    );
  });

  it("rejects numbers without an explicit country-code prefix", () => {
    expect(() => normalizeWhatsAppNumber("416-555-0123")).toThrow(
      "international WhatsApp number",
    );
  });
});

describe("sendWhatsAppSurvey", () => {
  it("sends an approved template through the Meta Cloud API", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 }),
    );

    const result = await sendWhatsAppSurvey({
      to: "+14165550123",
      employeeName: "Alex",
      surveyUrl: "https://tools.example/survey/token",
    });

    expect(result).toEqual({ messageId: "wamid.123" });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v24.0/123456789/messages");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "14165550123",
      type: "template",
      template: {
        name: "weekly_checkin",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "name", text: "Alex" },
              { type: "text", parameter_name: "link", text: "https://tools.example/survey/token" },
            ],
          },
        ],
      },
    });
  });

  it("surfaces Meta API errors", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 132001, message: "Template does not exist" } }), {
        status: 400,
      }),
    );

    await expect(
      sendWhatsAppSurvey({
        to: "+14165550123",
        employeeName: "Alex",
        surveyUrl: "https://tools.example/survey/token",
      }),
    ).rejects.toThrow("Meta WhatsApp error 132001: Template does not exist");
  });

  it("requires the template configuration", () => {
    delete process.env.WHATSAPP_SURVEY_TEMPLATE_NAME;
    expect(() => assertWhatsAppConfigured()).toThrow("WHATSAPP_SURVEY_TEMPLATE_NAME is not configured");
  });
});

describe("birthday WhatsApp templates", () => {
  it("sends the greeting template to the birthday employee", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.greeting" }] }), { status: 200 }),
    );
    await expect(sendWhatsAppBirthdayGreeting({
      to: "+14165550123",
      employeeName: "Alex",
    })).resolves.toEqual({ messageId: "wamid.greeting" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      template: {
        name: "employee_birthday_greeting",
        components: [{
          parameters: [{ type: "text", parameter_name: "name", text: "Alex" }],
        }],
      },
    });
  });

  it("sends the coworker reminder with both employee names", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reminder" }] }), { status: 200 }),
    );
    await expect(sendWhatsAppBirthdayReminder({
      to: "+14165550123",
      recipientName: "Sam",
      birthdayEmployeeName: "Alex",
    })).resolves.toEqual({ messageId: "wamid.reminder" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      template: {
        name: "employee_birthday_reminder",
        components: [{
          parameters: [
            { type: "text", parameter_name: "name", text: "Sam" },
            { type: "text", parameter_name: "birthday_name", text: "Alex" },
          ],
        }],
      },
    });
  });
});

describe("checkWhatsAppConnection", () => {
  it("validates the configured number without sending a message", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "123456789", verified_name: "RF Transparent" }), {
        status: 200,
      }),
    );

    await expect(checkWhatsAppConnection()).resolves.toBe("RF Transparent connected");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/123456789?fields=id,display_phone_number,verified_name",
      {
        headers: { Authorization: "Bearer test-token" },
        cache: "no-store",
      },
    );
  });
});
