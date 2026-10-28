import { recordLocation } from "./directory";
import type { CrmRecord } from "./types";

export const EXPORT_LIMIT = 10000;
const COLUMNS: [string, (record: CrmRecord) => string | null | undefined][] = [
  ["Name", record => record.title],
  ["Email", record => record.view_fields?.email],
  ["Phone", record => record.view_fields?.phone],
  ["Company", record => record.view_fields?.company],
  ["Website", record => record.view_fields?.website || record.view_fields?.domain],
  ["Owner", record => record.owner_email],
  ["Lifecycle stage", record => record.view_fields?.stage_label || record.view_fields?.stage],
  ["Street address", record => record.view_fields?.address],
  ["City", record => record.view_fields?.city],
  ["State / province", record => record.view_fields?.region],
  ["Country", record => record.view_fields?.country],
  ["Postal code", record => record.view_fields?.postal_code],
  ["Location", record => recordLocation(record.view_fields)],
  ["Date added", record => record.occurred_at],
  ["Last contacted", record => record.last_contacted_at],
  ["Next task", record => record.next_task_title],
  ["Next task due", record => record.next_task_due_at],
  ["Source", record => record.source === "tools" ? "Tools" : "HubSpot"],
  ["Record ID", record => record.id],
];

// Spreadsheet apps run cells that start with these characters as formulas.
function cell(value: string | null | undefined) {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function crmCsv(records: CrmRecord[], type: "contacts" | "companies") {
  const columns = COLUMNS.filter(([label]) => type === "contacts" || !["Email", "Company"].includes(label));
  const lines = [columns.map(([label]) => cell(label)).join(","), ...records.map(record => columns.map(([, value]) => cell(value(record))).join(","))];
  // A byte-order mark lets Excel open accented names correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}
