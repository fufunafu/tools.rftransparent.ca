"use client";
import { useState } from "react";
import type { CrmRecord } from "@/lib/crm/types";
import { canUpdateTask, setTaskStatus } from "./actions";

/** One-click complete or reopen. Only the task owner or management may change it. */
export default function QuickComplete({ record, email, canManage, onChanged, onError }: {
  record: CrmRecord; email: string; canManage: boolean; onChanged: () => void; onError?: (error: Error) => void;
}) {
  const [busy, setBusy] = useState(false);
  const done = record.effective_task_status === "completed";
  const allowed = !record.archived && canUpdateTask(record, email, canManage);
  const label = `${done ? "Reopen" : "Complete"} task: ${record.local_fields?.title || record.title}`;
  async function toggle() {
    setBusy(true);
    try { await setTaskStatus(record, done ? "open" : "completed"); onChanged(); }
    catch (cause) { onError?.(cause instanceof Error ? cause : new Error("Task could not be updated")); }
    finally { setBusy(false); }
  }
  return <button type="button" role="checkbox" aria-checked={done} aria-label={label} disabled={busy || !allowed}
    title={allowed ? label : "Only the task owner or management can change this task"} onClick={event => { event.stopPropagation(); void toggle(); }}
    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-not-allowed disabled:opacity-40 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent hover:border-emerald-600 hover:text-emerald-600"}`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m5 12 4 4 10-10" /></svg>
  </button>;
}
