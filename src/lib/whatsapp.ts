import { normalizeInternationalPhone } from "@/lib/phone";

const DEFAULT_GRAPH_API_VERSION = "v24.0";

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

interface WhatsAppTemplateResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; code?: number };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getConfig(): WhatsAppConfig {
  const graphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new Error("WHATSAPP_GRAPH_API_VERSION must look like v24.0");
  }

  const phoneNumberId = requiredEnv("WHATSAPP_PHONE_NUMBER_ID");
  if (!/^\d+$/.test(phoneNumberId)) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID must contain only digits");
  }

  return {
    accessToken: requiredEnv("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId,
    graphApiVersion,
  };
}

function graphUrl(config: WhatsAppConfig, path = ""): string {
  return `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}${path}`;
}

function errorMessage(payload: WhatsAppTemplateResponse | null, status: number): string {
  const message = payload?.error?.message?.trim();
  const code = payload?.error?.code;
  if (message) return `Meta WhatsApp error${code ? ` ${code}` : ""}: ${message}`;
  return `Meta WhatsApp request failed with HTTP ${status}`;
}

async function readJson(response: Response): Promise<WhatsAppTemplateResponse | null> {
  return response.json().catch(() => null) as Promise<WhatsAppTemplateResponse | null>;
}

export function normalizeWhatsAppNumber(value: string): string {
  return normalizeInternationalPhone(value).slice(1);
}

export function assertWhatsAppConfigured(): void {
  getConfig();
  const templateName = requiredEnv("WHATSAPP_SURVEY_TEMPLATE_NAME");
  if (!/^[a-z0-9_]+$/.test(templateName)) {
    throw new Error("WHATSAPP_SURVEY_TEMPLATE_NAME must use lowercase letters, numbers, and underscores");
  }
}

export async function sendWhatsAppSurvey({
  to,
  employeeName,
  surveyUrl,
  templateName,
}: {
  to: string;
  employeeName: string;
  surveyUrl: string;
  templateName?: string;
}): Promise<{ messageId: string }> {
  const config = getConfig();
  const selectedTemplate = templateName || requiredEnv("WHATSAPP_SURVEY_TEMPLATE_NAME");
  if (!/^[a-z0-9_]+$/.test(selectedTemplate)) {
    throw new Error("WhatsApp survey template names must use lowercase letters, numbers, and underscores");
  }
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_US";
  const recipient = normalizeWhatsAppNumber(to);

  const response = await fetch(graphUrl(config, "/messages"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: selectedTemplate,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "name", text: employeeName },
              { type: "text", parameter_name: "link", text: surveyUrl },
            ],
          },
        ],
      },
    }),
  });

  const payload = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));

  const messageId = payload?.messages?.[0]?.id;
  if (!messageId) throw new Error("Meta WhatsApp accepted the request without returning a message ID");
  return { messageId };
}

export async function sendWhatsAppEmployeeUpdate({
  to,
  employeeName,
  title,
  update,
}: {
  to: string;
  employeeName: string;
  title: string;
  update: string;
}): Promise<{ messageId: string }> {
  const config = getConfig();
  const templateName = requiredEnv("WHATSAPP_EMPLOYEE_UPDATE_TEMPLATE_NAME");
  if (!/^[a-z0-9_]+$/.test(templateName)) {
    throw new Error("WHATSAPP_EMPLOYEE_UPDATE_TEMPLATE_NAME must use lowercase letters, numbers, and underscores");
  }
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_US";
  const recipient = normalizeWhatsAppNumber(to);
  const response = await fetch(graphUrl(config, "/messages"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [{
          type: "body",
          parameters: [
            { type: "text", parameter_name: "name", text: employeeName },
            { type: "text", parameter_name: "title", text: title },
            { type: "text", parameter_name: "update", text: update },
          ],
        }],
      },
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  const messageId = payload?.messages?.[0]?.id;
  if (!messageId) throw new Error("Meta WhatsApp accepted the employee update without returning a message ID");
  return { messageId };
}

export async function checkWhatsAppConnection(): Promise<string> {
  const config = getConfig();
  const response = await fetch(`${graphUrl(config)}?fields=id,display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    cache: "no-store",
  });
  const payload = (await readJson(response)) as (WhatsAppTemplateResponse & {
    display_phone_number?: string;
    verified_name?: string;
  }) | null;
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return `${payload?.verified_name ?? payload?.display_phone_number ?? "WhatsApp number"} connected`;
}
