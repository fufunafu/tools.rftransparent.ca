"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import type { CrmRecord } from "@/lib/crm/types";
import { detailsFor } from "@/lib/crm/productivity";
import DetailFields, { readDetails } from "./DetailFields";
import { crmAction } from "./actions";
import { BUTTON, ErrorMessage, INPUT, PRIMARY, SINGLE, fetchJson, localInput } from "./shared";

/** Edit a call, meeting, email or note that was logged in Tools. */
export default function ActivityEditor({ record, onClose, onSaved }: { record: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The list row carries only a preview; load the full text before editing.
  const { data, error: loadError } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(record.id)}&view=detail`, fetchJson, { revalidateOnFocus: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const label = SINGLE[record.object_type].toLowerCase();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await crmAction({ action: "editActivity", id: data.id, version: data.version, title: String(form.get("title") ?? ""), body: String(form.get("body") ?? ""),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(), details: detailsFor(data.object_type, readDetails(form), { keepBlank: true }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not save the activity")); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="crm-activity-edit-title" className="max-h-[90dvh] w-[min(94vw,36rem)] overflow-y-auto rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40">
    <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 id="crm-activity-edit-title" className="text-xl font-bold text-slate-900">Edit {label}</h2><button type="button" className={BUTTON} disabled={busy} onClick={onClose}>Cancel</button></div>
      <ErrorMessage error={loadError} /><ErrorMessage error={error} />
      {!data && !loadError && <p role="status" className="text-sm text-slate-500">Loading the full {label}...</p>}
      {data && <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm font-medium">Title<input name="title" required maxLength={300} defaultValue={data.title} className={INPUT} /></label>
        <label className="block text-sm font-medium">Date and time<input name="occurredAt" type="datetime-local" required defaultValue={data.occurred_at ? localInput(new Date(data.occurred_at)) : localInput()} className={INPUT} /></label>
        <DetailFields type={data.object_type} values={{ ...data.view_fields, ...data.local_fields }} />
        <label className="block text-sm font-medium">{data.object_type === "emails" ? "Email body" : "Notes"}<textarea name="body" rows={8} maxLength={100000} defaultValue={data.body ?? ""} className={INPUT} /></label>
        <p className="text-xs text-slate-500">Your change is recorded in the change history with the previous text.</p>
        <div className="flex justify-end"><button className={PRIMARY}>{busy ? "Saving..." : "Save changes"}</button></div>
      </fieldset>}
    </form>
  </dialog>;
}
