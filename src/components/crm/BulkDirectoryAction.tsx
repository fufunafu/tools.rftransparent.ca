"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmRecord } from "@/lib/crm/types";
import { bulkDirectoryAction, type BulkDirectoryAction as BulkPayload, type DirectoryType } from "@/lib/crm/directory-workflows";
import { LIFECYCLE_STAGES } from "./DirectoryEditor";
import { BUTTON, INPUT, PRIMARY, ErrorMessage, fetchJson, localInput, ownerLabel, recordTitle, stageLabel, useDateLabel } from "./shared";

export default function BulkDirectoryAction({ type, records, email, onClose, onSaved }: { type: DirectoryType; records: CrmRecord[]; email: string; onClose: () => void; onSaved: (count: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"owner" | "stage" | "task">("owner");
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<{ bulk: BulkPayload; records: CrmRecord[] } | null>(null);
  const dateLabel = useDateLabel();
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const due = String(form.get("dueAt") ?? "");
    const change = kind === "task" ? { kind, title: String(form.get("title") ?? ""), body: String(form.get("body") ?? ""), dueAt: Number.isFinite(Date.parse(due)) ? new Date(due).toISOString() : "" } : { kind, value: String(form.get("value") ?? "").trim() };
    const parsed = bulkDirectoryAction.safeParse({ requestId: crypto.randomUUID(), type, records: records.map(record => ({ id: record.id, version: record.version })), change });
    if (!parsed.success) { setError(new Error("Enter valid values and a due date for follow-up tasks.")); return; }
    setBusy(true);
    try { const result = await fetchJson<{ records: CrmRecord[] }>("/api/crm/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "previewBulk", bulk: parsed.data }) }); setPreview({ bulk: parsed.data, records: result.records }); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Preview unavailable")); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError(null);
    try { const result = await fetchJson<{ updated: number }>("/api/crm/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "applyBulk", bulk: preview.bulk }) }); onSaved(result.updated); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Changes could not be saved")); }
    finally { setBusy(false); }
  }
  const change = preview?.bulk.change;
  return <dialog ref={dialog} aria-labelledby="bulk-action-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="max-h-[90dvh] w-[min(95vw,40rem)] overflow-y-auto rounded-xl p-0 shadow-2xl backdrop:bg-slate-950/40"><div className="space-y-4 p-5 sm:p-6"><div><h2 id="bulk-action-title" className="text-xl font-bold text-slate-900">{preview ? "Review changes" : "Update selected records"}</h2><p className="mt-1 text-sm text-slate-500">{records.length} selected {type}</p></div><ErrorMessage error={error} />
    {!preview ? <form onSubmit={prepare} className="space-y-4"><fieldset disabled={busy} className="space-y-4"><label className="block text-sm font-medium text-slate-700">Action<select value={kind} onChange={event => setKind(event.target.value as typeof kind)} className={INPUT}><option value="owner">Assign owner</option><option value="stage">Change lifecycle stage</option><option value="task">Create follow-up tasks</option></select></label>{kind === "owner" && <label className="block text-sm font-medium text-slate-700">New owner email<input name="value" type="email" maxLength={320} className={INPUT} /><span className="mt-1 block text-xs font-normal text-slate-500">Leave blank to make these records unassigned.</span></label>}{kind === "stage" && <label className="block text-sm font-medium text-slate-700">New lifecycle stage<select name="value" className={INPUT}><option value="">Not set</option>{LIFECYCLE_STAGES.map(stage => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></label>}{kind === "task" && <><label className="block text-sm font-medium text-slate-700">Task title<input name="title" required maxLength={300} defaultValue="Follow up" className={INPUT} /></label><label className="block text-sm font-medium text-slate-700">Due date and time<input type="datetime-local" name="dueAt" required className={INPUT} defaultValue={localInput(new Date(Date.now() + 86400000))} /></label><label className="block text-sm font-medium text-slate-700">Notes<textarea name="body" rows={3} maxLength={10000} className={INPUT} /></label><p className="text-xs text-slate-500">Creates one task per record, assigned to {ownerLabel(email)}. Email reminders start off.</p></>}</fieldset><div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" disabled={busy} className={BUTTON} onClick={onClose}>Cancel</button><button disabled={busy} className={PRIMARY}>{busy ? "Checking records..." : "Preview changes"}</button></div></form> : <>
      <p className="rounded-lg bg-orange-50 p-3 text-sm text-orange-900">{change?.kind === "owner" ? `Set owner to ${change.value || "Unassigned"}.` : change?.kind === "stage" ? `Set lifecycle stage to ${change.value ? stageLabel(change.value) : "Not set"}.` : change?.kind === "task" ? `Create “${change.title}” for each record, due ${dateLabel(change.dueAt)}.` : ""}</p>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">{preview.records.map(record => <li key={record.id} className="px-3 py-2 text-sm"><span className="font-semibold text-slate-800">{recordTitle(record)}</span><span className="mt-1 block text-xs text-slate-500">{change?.kind === "owner" ? `Current owner: ${record.owner_email || "Unassigned"}` : change?.kind === "stage" ? `Current stage: ${stageLabel(record.view_fields?.stage)}` : `Task assigned to ${ownerLabel(email)}`}</span></li>)}</ul><p className="text-xs text-slate-500">Your changes will be recorded in each record’s change history. If a selected record has changed, the whole batch will stop for review.</p><div className="flex justify-end gap-2"><button disabled={busy} className={BUTTON} onClick={() => { setPreview(null); setError(null); }}>Back</button><button disabled={busy} className={BUTTON} onClick={onClose}>Cancel</button><button disabled={busy} className={PRIMARY} onClick={() => void apply()}>{busy ? "Applying..." : `Apply to ${records.length} records`}</button></div>
    </>}
  </div></dialog>;
}
