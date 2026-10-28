"use client";
import { useState, type FormEvent } from "react";
import type { CrmRecord } from "@/lib/crm/types";
import { detailsFor } from "@/lib/crm/productivity";
import DetailFields, { readDetails } from "./DetailFields";
import StaffSelect from "./StaffSelect";
import { canUpdateTask, crmAction, rescheduleOptions } from "./actions";
import { ErrorMessage, INPUT, PRIMARY, fetchJson, localInput, ownerLabel } from "./shared";

/** Full task editor: details, assignment, status, due date and reminders. */
export default function TaskPanel({ record, email, canManage, onSaved }: { record: CrmRecord; email: string; canManage: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const [due, setDue] = useState(record.effective_due_at ? localInput(new Date(record.effective_due_at)) : "");
  // The latest saved version, so a retry after a partly saved change still works.
  const [version, setVersion] = useState(record.version);
  const canSchedule = canUpdateTask(record, email, canManage);
  const canEditDetails = canSchedule || record.created_by_email === email;
  const imported = record.source !== "tools";
  if (!canEditDetails) return <p className="mt-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">Assigned to <span className="capitalize">{ownerLabel(record.owner_email)}</span>. The task owner, its creator, or management can update it.</p>;
  const fields = { ...record.view_fields, ...record.local_fields };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim(), body = imported ? record.body ?? "" : String(form.get("body") ?? "");
    // Only a newly chosen owner is sent; an unassigned task stays unassigned.
    const owner = String(form.get("owner") ?? ""), ownerChanged = owner !== "" && owner !== (record.owner_email ?? "");
    const details = detailsFor("tasks", readDetails(form), { keepBlank: true });
    const detailsChanged = title !== (record.local_fields?.title || record.title) || body !== (record.body ?? "") || ownerChanged
      || (details.priority ?? "") !== (fields.priority ?? "") || (details.task_type ?? "") !== (fields.task_type ?? "");
    // The due field has minute precision and the database returns its own format.
    const minute = (value: string | null | undefined) => value ? Math.floor(Date.parse(value) / 60000) : null;
    try {
      let current = version;
      // Schedule first: after a reassignment the current owner may no longer change it.
      if (canSchedule && form.has("status")) {
        const status = form.get("status"), dueAt = new Date(String(form.get("due"))).toISOString();
        const reminderEnabled = form.get("reminderEnabled") === "on", reminderMinutes = Number(form.get("reminderMinutes") || 60);
        if (status !== record.effective_task_status || minute(dueAt) !== minute(record.effective_due_at) || reminderEnabled !== (record.reminder_enabled ?? false) || reminderMinutes !== (record.reminder_minutes ?? 60)) {
          current = (await fetchJson<{ version: number }>("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, version: current, status, dueAt, reminderEnabled, reminderMinutes }) })).version;
          setVersion(current);
        }
      }
      if (detailsChanged) await crmAction({ action: "editTask", id: record.id, version: current, title, body, ...(ownerChanged ? { ownerEmail: owner } : {}), details });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not update task")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <h3 className="font-semibold text-slate-800">Task</h3><ErrorMessage error={error} />
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm font-medium">Title<input name="title" required maxLength={300} defaultValue={record.local_fields?.title || record.title} className={INPUT} /></label>
      {imported ? <p className="text-xs text-slate-500">Notes on imported HubSpot tasks are read-only. Add a note to the contact instead.</p>
        : <label className="block text-sm font-medium">Notes<textarea name="body" rows={4} maxLength={100000} defaultValue={record.body ?? ""} className={INPUT} /></label>}
      <div className="grid gap-3 sm:grid-cols-2"><StaffSelect name="owner" label="Assigned to" defaultValue={record.owner_email ?? ""} email={email} allowUnassigned={!record.owner_email} /></div>
      <DetailFields type="tasks" values={fields} />
      {canSchedule ? <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Status<select name="status" defaultValue={record.effective_task_status || "open"} className={INPUT}><option value="open">Open</option><option value="completed">Completed</option></select></label>
          <label className="block text-sm font-medium">Due date and time<input type="datetime-local" name="due" required value={due} onChange={event => setDue(event.target.value)} className={INPUT} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-500">Reschedule:</span>{rescheduleOptions().map(([label, date]) => <button type="button" key={label} onClick={() => setDue(localInput(date))} className="min-h-8 rounded-full border border-slate-200 px-3 font-semibold text-slate-600 hover:bg-slate-50">{label}</button>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reminderEnabled" defaultChecked={record.reminder_enabled ?? false} />Email reminders to the task owner</label>
        <label className="block text-xs text-slate-600">Remind before due<select name="reminderMinutes" defaultValue={record.reminder_minutes ?? 60} className={INPUT}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label>
        <p className="text-xs text-slate-500">One reminder before due and one when overdue. Imported tasks start with reminders off.</p>
      </div> : <p className="text-xs text-slate-500">Only the task owner or management can change the status, due date or reminders.</p>}
      <button className={PRIMARY}>{busy ? "Saving..." : "Update task"}</button>
    </fieldset>
  </form>;
}
