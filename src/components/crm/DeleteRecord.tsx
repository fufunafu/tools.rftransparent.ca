"use client";
import { useEffect, useRef, useState } from "react";
import type { CrmRecord } from "@/lib/crm/types";
import { canDelete, deletedInfo } from "@/lib/crm/productivity";
import { crmAction } from "./actions";
import { BUTTON, ErrorMessage, SINGLE, ownerLabel, recordTitle, useDateLabel } from "./shared";

/** Delete with a confirmation step (no browser pop-up), or restore a Tools deletion. */
export default function DeleteRecord({ record, email, canManage, onChanged, compact = false }: {
  record: CrmRecord; email: string; canManage: boolean; onChanged: () => void; compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const dateLabel = useDateLabel();
  const deleted = deletedInfo(record);
  if (!canDelete(record, email, canManage)) return null;
  async function run(action: "delete" | "restore") {
    setBusy(true); setError(null);
    try { await crmAction({ action, id: record.id, version: record.version }); setConfirming(false); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not update the record")); }
    finally { setBusy(false); }
  }
  if (record.archived) {
    if (!deleted) return null;
    return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p>Deleted by <span className="capitalize">{ownerLabel(deleted.by)}</span> · {dateLabel(deleted.at)}</p>
      <ErrorMessage error={error} />
      <button className={`${BUTTON} mt-2`} disabled={busy} onClick={() => void run("restore")}>{busy ? "Restoring..." : `Restore ${SINGLE[record.object_type].toLowerCase()}`}</button>
    </div>;
  }
  return <>
    <button type="button" onClick={() => setConfirming(true)} className={compact ? "min-h-8 rounded px-2 text-xs font-semibold text-red-700 hover:bg-red-50" : "min-h-10 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50"}>Delete</button>
    {confirming && <ConfirmDelete record={record} busy={busy} error={error} onCancel={() => { setConfirming(false); setError(null); }} onConfirm={() => void run("delete")} />}
  </>;
}

function ConfirmDelete({ record, busy, error, onCancel, onConfirm }: { record: CrmRecord; busy: boolean; error: Error | null; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const type = SINGLE[record.object_type].toLowerCase();
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="crm-delete-title" className="w-[min(92vw,28rem)] rounded-xl p-0 shadow-2xl backdrop:bg-slate-950/40">
    <div className="space-y-4 p-5">
      <h2 id="crm-delete-title" className="text-lg font-bold text-slate-900">Delete this {type}?</h2>
      <p className="text-sm text-slate-600">&ldquo;{recordTitle(record)}&rdquo; will be hidden from lists and timelines. It stays in the change history and can be restored from Archived records.</p>
      <ErrorMessage error={error} />
      <div className="flex justify-end gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" disabled={busy} onClick={onConfirm} className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">{busy ? "Deleting..." : `Delete ${type}`}</button></div>
    </div>
  </dialog>;
}
