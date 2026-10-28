import { z } from "zod";
import { crmId } from "./input";
import type { CrmRecord, CrmType } from "./types";

// Short labels saved in local_fields. Imported HubSpot values are left as-is.
export const CALL_OUTCOMES = { connected: "Connected", voicemail: "Left voicemail", no_answer: "No answer", busy: "Busy", wrong_number: "Wrong number" } as const;
export const CALL_DIRECTIONS = { outbound: "Outbound", inbound: "Inbound" } as const;
export const MEETING_OUTCOMES = { completed: "Completed", scheduled: "Scheduled", rescheduled: "Rescheduled", no_show: "No show", cancelled: "Cancelled" } as const;
export const EMAIL_DIRECTIONS = { sent: "Sent", received: "Received" } as const;
export const TASK_PRIORITIES = { high: "High", medium: "Medium", low: "Low" } as const;
export const TASK_TYPES = { todo: "To-do", call: "Call", email: "Email" } as const;
export const EDITABLE_ACTIVITIES: CrmType[] = ["calls", "meetings", "emails", "notes"];
export const DELETABLE_TYPES: CrmType[] = ["contacts", "companies", "tasks", "calls", "meetings", "emails", "notes"];

// A blank value clears a detail when editing; new records simply omit it.
const keys = <T extends Record<string, string>>(labels: T) => z.union([z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]), z.literal("")]);
const duration = z.union([z.string().regex(/^\d{1,4}$/).refine(value => Number(value) <= 1440, "Duration must be 24 hours or less"), z.literal("")]);
export const activityDetails = z.object({
  call_outcome: keys(CALL_OUTCOMES).optional(), call_direction: keys(CALL_DIRECTIONS).optional(),
  duration_minutes: duration.optional(), meeting_outcome: keys(MEETING_OUTCOMES).optional(), email_direction: keys(EMAIL_DIRECTIONS).optional(),
}).strict();
export const taskDetails = z.object({ priority: keys(TASK_PRIORITIES).optional(), task_type: keys(TASK_TYPES).optional() }).strict();
export type ActivityDetails = z.infer<typeof activityDetails>;
export type TaskDetails = z.infer<typeof taskDetails>;

/** Only the details that make sense for one record type are kept. Blank
 * values are dropped unless keepBlank is set, where they clear a saved value. */
export function detailsFor(type: CrmType, input: Record<string, unknown>, { keepBlank = false } = {}): Record<string, string> {
  const allowed: Partial<Record<CrmType, string[]>> = {
    calls: ["call_outcome", "call_direction", "duration_minutes"], meetings: ["meeting_outcome", "duration_minutes"],
    emails: ["email_direction"], tasks: ["priority", "task_type"], contacts: ["stage"], companies: ["stage"],
  };
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed[type]?.includes(key) && typeof value === "string" && (keepBlank || value !== ""))) as Record<string, string>;
}

const email = z.email().max(320).transform(value => value.toLowerCase());
export const crmAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("editActivity"), id: crmId, version: z.number().int().positive(), title: z.string().trim().min(1).max(300),
    body: z.string().max(100000), occurredAt: z.string().datetime({ offset: true }), details: activityDetails }).strict(),
  z.object({ action: z.literal("editTask"), id: crmId, version: z.number().int().positive(), title: z.string().trim().min(1).max(300),
    body: z.string().max(100000), ownerEmail: email.optional(), details: taskDetails }).strict(),
  z.object({ action: z.enum(["delete", "restore"]), id: crmId, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("pin"), recordId: crmId, activityId: crmId.nullable() }).strict(),
  z.object({ action: z.enum(["link", "unlink"]), fromId: crmId, toId: crmId }).strict(),
]);
export type CrmAction = z.infer<typeof crmAction>;

/** Visible chips for a timeline entry, from Tools details only. */
export function activityChips(record: Pick<CrmRecord, "object_type" | "view_fields" | "local_fields">): string[] {
  const fields = { ...record.view_fields, ...record.local_fields };
  const chips: string[] = [];
  const add = (labels: Record<string, string>, key: string) => { const value = fields[key]; if (value && labels[value]) chips.push(labels[value]); };
  if (record.object_type === "calls") { add(CALL_DIRECTIONS, "call_direction"); add(CALL_OUTCOMES, "call_outcome"); }
  if (record.object_type === "meetings") add(MEETING_OUTCOMES, "meeting_outcome");
  if (record.object_type === "emails") add(EMAIL_DIRECTIONS, "email_direction");
  if (record.object_type === "tasks") { add(TASK_TYPES, "task_type"); if (fields.priority && fields.priority in TASK_PRIORITIES) chips.push(`${TASK_PRIORITIES[fields.priority as keyof typeof TASK_PRIORITIES]} priority`); }
  if (["calls", "meetings"].includes(record.object_type) && /^\d+$/.test(fields.duration_minutes ?? "") && Number(fields.duration_minutes) > 0) chips.push(`${fields.duration_minutes} min`);
  return chips;
}

/** The person who may delete or restore: the Tools creator, or management. */
export function canDelete(record: Pick<CrmRecord, "source" | "created_by_email" | "object_type">, email: string, canManage: boolean) {
  return DELETABLE_TYPES.includes(record.object_type) && (canManage || (record.source === "tools" && record.created_by_email === email));
}
export function canEditActivity(record: Pick<CrmRecord, "source" | "created_by_email" | "object_type" | "archived">, email: string, canManage: boolean) {
  // Captured activity has no creator and is refreshed from its source, so it stays read-only.
  return EDITABLE_ACTIVITIES.includes(record.object_type) && record.source === "tools" && Boolean(record.created_by_email) && !record.archived && (canManage || record.created_by_email === email);
}
export function deletedInfo(record: Pick<CrmRecord, "local_fields">) {
  const at = record.local_fields?.deleted_at, by = record.local_fields?.deleted_by;
  return at ? { at, by: by || "" } : null;
}

// Messages raised by the productivity database functions. Anything else gets a
// generic reply so database internals never reach the browser.
const KNOWN_ERRORS = [
  "Activity changed. Refresh before saving.", "Task changed. Refresh before saving.", "Record changed. Refresh before saving.",
  "Imported activity is read-only", "Captured activity is read-only", "Imported task notes are read-only", "Only the author or management may edit this activity",
  "Only the task owner, its creator or management may update this task", "Only the creator or management may delete this record",
  "Only records deleted in Tools can be restored", "Record is already archived", "This record type cannot be deleted",
  "Only associations added in Tools can be removed", "These records cannot be associated", "Pin an activity linked to this record",
  "Related record unavailable", "Record unavailable", "Activity unavailable", "Task unavailable", "Tasks need an owner",
] as const;
export const MIGRATION_MESSAGE = "This CRM feature needs a database update before it can be used. Ask management to apply the CRM productivity update.";
export function databaseError(error: { message?: string; code?: string } | null | undefined, fallback: string): { message: string; status: number } {
  if (!error) return { message: fallback, status: 409 };
  if (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01") return { message: MIGRATION_MESSAGE, status: 503 };
  const known = KNOWN_ERRORS.find(message => error.message?.includes(message));
  if (!known) return { message: fallback, status: 409 };
  return { message: known, status: known.includes(" may ") ? 403 : 409 };
}
