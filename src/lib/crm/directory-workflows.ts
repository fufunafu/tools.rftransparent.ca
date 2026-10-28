import { z } from "zod";
import { crmId } from "./input";
import { DIRECTORY_SORTS } from "./directory";
import { projectCrmLocation } from "./location.mjs";

export const DIRECTORY_COLUMNS = {
  email: "Email", phone: "Phone", company: "Company", domain: "Domain", location: "Location",
  owner: "Owner", stage: "Lifecycle stage", lastContact: "Last contacted", nextTask: "Next task", added: "Date added",
} as const;
export type DirectoryColumn = keyof typeof DIRECTORY_COLUMNS;
export const FOLLOWUP_FILTERS = {
  all: "Any follow-up", overdue: "Overdue tasks", no_task: "No open task", neglected: "No contact in 30 days", never: "Never contacted",
} as const;
export type FollowupFilter = keyof typeof FOLLOWUP_FILTERS;
export type DirectoryType = "contacts" | "companies";
export const defaultColumns = (type: DirectoryType): DirectoryColumn[] => type === "contacts"
  ? ["email", "company", "owner", "stage", "lastContact", "nextTask"]
  : ["domain", "location", "owner", "stage", "lastContact", "nextTask"];
export const availableColumns = (type: DirectoryType) => (Object.keys(DIRECTORY_COLUMNS) as DirectoryColumn[]).filter(key => type === "contacts" ? key !== "domain" : key !== "email" && key !== "company");
const text = (max: number) => z.string().trim().max(max);
const email = z.union([z.email().max(320), z.literal("")]).transform(value => value.toLowerCase());
const webAddress = text(500).refine(value => {
  if (!value) return true;
  try { const url = new URL(value.includes("://") ? value : `https://${value}`); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname.includes(".")) && !url.username && !url.password; }
  catch { return false; }
}, "Enter a website address.");
export const directoryEdit = z.object({
  action: z.literal("editRecord"), id: crmId, version: z.number().int().positive(),
  fields: z.object({
    title: text(300).min(1), email, phone: text(60), company: text(300), stage: text(120),
    owner_email: email, address: text(500), city: text(500), region: text(500), country: text(500), postal_code: text(40),
    website: webAddress, domain: webAddress,
  }).strict(),
  companyId: crmId.nullable().default(null),
}).strict().transform(input => ({ ...input, fields: { ...input.fields,
  ...projectCrmLocation({ country: input.fields.country, state: input.fields.region, city: input.fields.city }),
} }));
const filterValues = z.array(text(500)).max(20);
export const savedViewConfig = z.object({
  search: text(200), filters: z.object({ owner: filterValues, stage: filterValues, country: filterValues, region: filterValues, city: filterValues }).strict(),
  sort: z.enum(Object.keys(DIRECTORY_SORTS) as [keyof typeof DIRECTORY_SORTS, ...Array<keyof typeof DIRECTORY_SORTS>]),
  source: z.enum(["", "tools", "hubspot"]), mine: z.boolean(), archived: z.boolean(), recent: z.boolean(),
  followup: z.enum(Object.keys(FOLLOWUP_FILTERS) as [FollowupFilter, ...FollowupFilter[]]),
  columns: z.array(z.enum(Object.keys(DIRECTORY_COLUMNS) as [DirectoryColumn, ...DirectoryColumn[]])).max(10).refine(values => new Set(values).size === values.length),
}).strict();
export type DirectoryViewConfig = z.infer<typeof savedViewConfig>;
export function directoryViewSignature(view: DirectoryViewConfig) {
  return JSON.stringify([view.search, view.filters.owner, view.filters.stage, view.filters.country, view.filters.region, view.filters.city,
    view.sort, view.source, view.mine, view.archived, view.recent, view.followup, view.columns]);
}
export const saveDirectoryView = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative(), name: text(80).min(1), type: z.enum(["contacts", "companies"]), config: savedViewConfig,
}).strict().refine(input => input.config.columns.every(column => availableColumns(input.type).includes(column)), "Invalid columns for this directory");
export interface SavedDirectoryView { id: string; name: string; object_type: DirectoryType; config: DirectoryViewConfig; version: number }
export const bulkSelection = z.array(z.object({ id: crmId, version: z.number().int().positive() }).strict()).min(1).max(50)
  .refine(records => new Set(records.map(record => record.id)).size === records.length, "Select each record once");
export const bulkChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), value: email }).strict(),
  z.object({ kind: z.literal("stage"), value: text(120) }).strict(),
  z.object({ kind: z.literal("task"), title: text(300).min(1), body: text(10000), dueAt: z.string().datetime({ offset: true }) }).strict(),
]);
export const bulkDirectoryAction = z.object({
  requestId: z.string().uuid(), type: z.enum(["contacts", "companies"]), records: bulkSelection, change: bulkChange,
}).strict();
export type BulkDirectoryAction = z.infer<typeof bulkDirectoryAction>;
export interface CrmAuditEntry { id: number; actor_email: string; action: string; detail: Record<string, unknown>; created_at: string }
