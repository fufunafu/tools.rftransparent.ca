"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmRecord, CrmType } from "@/lib/crm/types";
import { ACTIVITIES, BUTTON, PRIMARY, INPUT, SINGLE, ErrorMessage, fetchJson, localInput } from "./shared";

export default function RecordForm({ type, related, onClose, onSaved }: { type: CrmType; related: CrmRecord | null; onClose: () => void; onSaved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const activity = ACTIVITIES.includes(type);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const result = await fetchJson<{ id: string }>("/api/crm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type, title: form.get("title"), body: form.get("body") || "", email: form.get("email") || "", phone: form.get("phone") || "", company: form.get("company") || "",
          occurredAt: form.get("occurredAt") ? new Date(String(form.get("occurredAt"))).toISOString() : new Date().toISOString(),
          dueAt: type === "tasks" ? new Date(String(form.get("dueAt"))).toISOString() : null, relatedId: related?.id ?? null }),
      });
      onSaved(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not save record")); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="w-[min(92vw,36rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40" aria-labelledby="crm-form-title">
    <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4"><h2 id="crm-form-title" className="text-xl font-bold text-slate-900">{type === "tasks" ? "Schedule a task" : activity ? `Log ${SINGLE[type].toLowerCase()}` : `New ${SINGLE[type].toLowerCase()}`}</h2><button type="button" aria-label="Close form" disabled={busy} onClick={onClose} className={BUTTON}>Close</button></div>
      <p className="text-sm text-slate-600">{related ? `Linked to ${related.title}. ` : ""}Saved in Tools.{type === "emails" ? " Record a conversation you have already sent or received." : ""}</p>
      <ErrorMessage error={error} />
      <label className="block text-sm font-medium">{type === "contacts" || type === "companies" ? "Name" : "Title"}<input autoFocus name="title" required maxLength={300} className={INPUT} placeholder={type === "tasks" ? "Follow up on the railing quote" : undefined} /></label>
      {!activity && <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Email<input name="email" type="email" maxLength={320} className={INPUT} /></label><label className="block text-sm font-medium">Phone<input name="phone" type="tel" maxLength={60} className={INPUT} /></label><label className="block text-sm font-medium sm:col-span-2">Company<input name="company" maxLength={300} className={INPUT} /></label></div>}
      {activity && type !== "tasks" && <label className="block text-sm font-medium">Activity date and time<input name="occurredAt" type="datetime-local" required defaultValue={localInput()} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time</span></label>}
      {type === "tasks" && <label className="block text-sm font-medium">Due date and time<input name="dueAt" type="datetime-local" required defaultValue={localInput(new Date(Date.now() + 86400000))} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time. The task appears in your upcoming and overdue queue.</span></label>}
      <label className="block text-sm font-medium">{type === "emails" ? "Email body" : "Notes"}<textarea name="body" rows={6} maxLength={100000} className={INPUT} /></label>
      <div className="flex justify-end"><button disabled={busy} className={PRIMARY}>{busy ? "Saving..." : type === "tasks" ? "Schedule task" : "Save in Tools"}</button></div>
    </form>
  </dialog>;
}
