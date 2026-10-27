import { z } from "zod";
import { CRM_TYPES } from "./types";

export const crmId = z.string().regex(/^(tools:[0-9a-f-]{36}|hubspot:[0-9]+:[a-z_]+:[0-9]+)$/).max(160);
export const createCrmRecord = z.object({
  requestId: z.string().uuid(), type: z.enum(CRM_TYPES), title: z.string().trim().min(1).max(300),
  body: z.string().trim().max(100000).default(""), occurredAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }).nullable(), relatedId: crmId.nullable(),
  email: z.union([z.email().max(320), z.literal("")]).default(""),
  phone: z.string().trim().max(60).default(""), company: z.string().trim().max(300).default(""),
  reminderEnabled: z.boolean().default(false), reminderMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]).default(60),
}).refine(input => input.type !== "tasks" || input.dueAt !== null, { message: "Choose a due date for the task." });
export const updateCrmTask = z.object({
  id: crmId, version: z.number().int().positive(), status: z.enum(["open", "completed"]),
  dueAt: z.string().datetime({ offset: true }),
  reminderEnabled: z.boolean().optional(), reminderMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]).optional(),
}).refine(value => (value.reminderEnabled === undefined) === (value.reminderMinutes === undefined), { message: "Choose both reminder settings." });

export const editCrmContact = z.object({
  action: z.literal("editContact"), id: crmId, version: z.number().int().positive(),
  fields: z.object({ title: z.string().trim().min(1).max(300), email: z.union([z.email().max(320), z.literal("")]), phone: z.string().trim().max(60), company: z.string().trim().max(300), stage: z.string().trim().max(120) }).strict(),
});

export class CrmInputError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function readCrmJson(request: Request): Promise<unknown> {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new CrmInputError("Origin not allowed", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new CrmInputError("JSON required", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new CrmInputError("Body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 150000) { await reader.cancel(); throw new CrmInputError("Record is too large", 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof CrmInputError) throw error;
    throw new CrmInputError("Invalid JSON");
  } finally { reader.releaseLock(); }
}
