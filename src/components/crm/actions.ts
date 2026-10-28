import type { CrmAction } from "@/lib/crm/productivity";
import type { CrmRecord } from "@/lib/crm/types";
import { fetchJson } from "./shared";

export function crmAction<T = { saved?: boolean; version?: number }>(body: CrmAction) {
  return fetchJson<T>("/api/crm/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Complete or reopen a task without changing its due date or reminders. */
export function setTaskStatus(record: Pick<CrmRecord, "id" | "version" | "effective_due_at">, status: "open" | "completed") {
  return fetchJson<{ saved: boolean; version: number }>("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: record.id, version: record.version, status, dueAt: record.effective_due_at ?? new Date().toISOString() }) });
}

export function canUpdateTask(record: Pick<CrmRecord, "owner_email">, email: string, canManage: boolean) {
  return canManage || record.owner_email === email;
}

/** Quick reschedule targets, at 9:00 in the viewer's local time. */
export function rescheduleOptions(now = new Date()) {
  const at = (days: number) => { const date = new Date(now); date.setDate(date.getDate() + days); date.setHours(9, 0, 0, 0); return date; };
  const monday = (8 - now.getDay()) % 7 || 7;
  return [["Tomorrow", at(1)], ["In 3 days", at(3)], ["Next Monday", at(monday)], ["In 2 weeks", at(14)]] as const;
}
