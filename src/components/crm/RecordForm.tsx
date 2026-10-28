"use client";

import RecordAvatar from "./RecordAvatar";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import type { CrmRecord, CrmType } from "@/lib/crm/types";
import type { CrmDuplicateMatch } from "@/lib/crm/search";
import { detailsFor } from "@/lib/crm/productivity";
import { RecordPicker } from "./AssociationsPanel";
import DetailFields, { readDetails } from "./DetailFields";
import { LIFECYCLE_STAGES } from "./DirectoryEditor";
import StaffSelect from "./StaffSelect";
import { ACTIVITIES, BUTTON, PRIMARY, INPUT, SINGLE, ErrorMessage, fetchJson, localInput, recordTitle, stageLabel } from "./shared";

export default function RecordForm({ type, related, email = "", onClose, onSaved, onOpenExisting }: {
  type: CrmType; related: CrmRecord | null; email?: string; onClose: () => void; onSaved: (id: string) => void; onOpenExisting?: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [dirty, setDirty] = useState(false), [keptDraft, setKeptDraft] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const activity = ACTIVITIES.includes(type);
  const directory = type === "contacts" || type === "companies";
  const [contact, setContact] = useState<CrmRecord | null>(null);
  const [company, setCompany] = useState<CrmRecord | null>(null);
  const [companyName, setCompanyName] = useState("");
  // Inputs the duplicate check watches, debounced so typing stays quick.
  const [identity, setIdentity] = useState({ name: "", email: "", phone: "" }), [checked, setChecked] = useState(identity);
  useEffect(() => { const timer = setTimeout(() => setChecked(identity), 500); return () => clearTimeout(timer); }, [identity]);
  const duplicateUrl = directory && (checked.name.trim().length >= 2 || checked.email.includes("@") || checked.phone.replace(/\D/g, "").length >= 7)
    ? `/api/crm/search?${new URLSearchParams({ duplicates: type, name: checked.name.trim(), email: checked.email.trim(), phone: checked.phone.trim() })}` : null;
  const { data: duplicates } = useSWR<{ matches: CrmDuplicateMatch[] }>(duplicateUrl, fetchJson, { revalidateOnFocus: false });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    const details = detailsFor(type, { ...readDetails(form), stage: String(form.get("stage") ?? "") });
    const primary = related?.id ?? (type === "contacts" ? company?.id : contact?.id ?? company?.id) ?? null;
    const extra = !related && activity && contact && company ? [company.id] : [];
    const owner = form.has("owner") ? String(form.get("owner")) : undefined;
    try {
      const result = await fetchJson<{ id: string }>("/api/crm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, type, title: form.get("title"), body: form.get("body") || "", email: form.get("email") || "", phone: form.get("phone") || "", company: form.get("company") || "",
          occurredAt: form.get("occurredAt") ? new Date(String(form.get("occurredAt"))).toISOString() : new Date().toISOString(),
          dueAt: type === "tasks" ? new Date(String(form.get("dueAt"))).toISOString() : null, relatedId: primary,
          reminderEnabled: type === "tasks" && form.get("reminderEnabled") === "on", reminderMinutes: Number(form.get("reminderMinutes") || 60),
          ...(owner !== undefined ? { ownerEmail: owner } : {}), details, extraRelatedIds: extra }),
      });
      onSaved(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not save record")); }
    finally { setBusy(false); }
  }
  const matches = duplicateUrl ? duplicates?.matches ?? [] : [];
  // Escape closes an untouched form but keeps a typed draft; Close discards it.
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (busy) return; if (dirty) setKeptDraft(true); else onClose(); }} className="max-h-[92dvh] w-[min(94vw,38rem)] overflow-y-auto rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40" aria-labelledby="crm-form-title">
    <form onSubmit={submit} onInput={() => setDirty(true)} className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4"><h2 id="crm-form-title" className="text-xl font-bold text-slate-900">{type === "tasks" ? "Schedule a task" : activity ? `Log ${SINGLE[type].toLowerCase()}` : `New ${SINGLE[type].toLowerCase()}`}</h2><button type="button" aria-label="Close form" disabled={busy} onClick={onClose} className={BUTTON}>Close</button></div>
      <p className="text-sm text-slate-600">{related ? `Linked to ${recordTitle(related)}. ` : ""}Saved in Tools.{type === "emails" ? " Record a conversation you have already sent or received." : ""}</p>
      <ErrorMessage error={error} />{keptDraft && <p role="status" className="text-xs text-slate-500">Your entry is kept. Use Close to discard it.</p>}
      <label className="block text-sm font-medium">{directory ? "Name" : "Title"}<input autoFocus name="title" required maxLength={300} onChange={event => directory && setIdentity(current => ({ ...current, name: event.target.value }))} className={INPUT} placeholder={type === "tasks" ? "Follow up on the railing quote" : undefined} /></label>
      {!related && activity && <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
        <Chooser label="Associated contact" type="contacts" chosen={contact} onChoose={setContact} />
        <Chooser label="Associated company" type="companies" chosen={company} onChoose={setCompany} />
      </div>}
      {directory && <div className="grid gap-3 sm:grid-cols-2">
        {type === "contacts" && <label className="block text-sm font-medium">Email<input name="email" type="email" maxLength={320} onChange={event => setIdentity(current => ({ ...current, email: event.target.value }))} className={INPUT} /></label>}
        <label className="block text-sm font-medium">Phone<input name="phone" type="tel" maxLength={60} onChange={event => setIdentity(current => ({ ...current, phone: event.target.value }))} className={INPUT} /></label>
        {type === "contacts" && <div className="sm:col-span-2">{related?.object_type === "companies" ? <input type="hidden" name="company" value={related.title} /> : company
          ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><input type="hidden" name="company" value={recordTitle(company)} />Linked to company <strong>{recordTitle(company)}</strong> <button type="button" className="ml-2 text-xs font-semibold underline" onClick={() => setCompany(null)}>Change</button></div>
          : <><label className="block text-sm font-medium">Company<input name="company" maxLength={300} value={companyName} onChange={event => setCompanyName(event.target.value)} className={INPUT} placeholder="Type a name, or link an existing company below" /></label>
            <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-cyan-800">Link an existing company</summary><RecordPicker type="companies" autoFocus={false} onPick={picked => { setCompany(picked); setCompanyName(recordTitle(picked)); }} /></details></>}</div>}
        <StaffSelect name="owner" label="Owner" defaultValue={email} email={email} allowUnassigned />
        <label className="block text-sm font-medium">Lifecycle stage<select name="stage" defaultValue="" className={INPUT}><option value="">Not set</option>{LIFECYCLE_STAGES.map(value => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></label>
      </div>}
      {matches.length > 0 && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">This {SINGLE[type].toLowerCase()} may already exist</p>
        <ul className="mt-2 space-y-1">{matches.map(match => <li key={match.id} className="flex flex-wrap items-center justify-between gap-2"><span>{match.title} <span className="text-xs text-amber-800">· same {match.reason}{match.reason !== "name" ? ` (${match.detail})` : ""}</span></span>{onOpenExisting && <button type="button" className="text-xs font-semibold underline" onClick={() => onOpenExisting(match.id)}>Open existing</button>}</li>)}</ul>
        <p className="mt-2 text-xs">You can still save if this is a different customer.</p>
      </div>}
      {(type === "calls" || type === "meetings" || type === "emails") && <DetailFields type={type} />}
      {activity && type !== "tasks" && <label className="block text-sm font-medium">Activity date and time<input name="occurredAt" type="datetime-local" required defaultValue={localInput()} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time</span></label>}
      {type === "tasks" && <><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Due date and time<input name="dueAt" type="datetime-local" required defaultValue={localInput(new Date(Date.now() + 86400000))} className={INPUT} /><span className="text-xs font-normal text-slate-500">Your local time</span></label><StaffSelect name="owner" label="Assigned to" defaultValue={email} email={email} /></div>
        <DetailFields type="tasks" />
        <div className="space-y-3 rounded-xl bg-orange-50 p-4"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="reminderEnabled" defaultChecked />Email task reminders to the assignee</label><label className="block text-xs text-slate-600">Remind before due<select name="reminderMinutes" defaultValue="60" className={INPUT}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label><p className="text-xs text-slate-600">One email before the due time and one if overdue. Completing the task stops pending reminders.</p></div></>}
      <label className="block text-sm font-medium">{type === "emails" ? "Email body" : "Notes"}<textarea name="body" rows={6} maxLength={100000} className={INPUT} /></label>
      <div className="flex justify-end"><button disabled={busy} className={PRIMARY}>{busy ? "Saving..." : type === "tasks" ? "Schedule task" : "Save in Tools"}</button></div>
    </form>
  </dialog>;
}

function Chooser({ label, type, chosen, onChoose }: { label: string; type: "contacts" | "companies"; chosen: CrmRecord | null; onChoose: (record: CrmRecord | null) => void }) {
  return <div className="min-w-0"><p className="text-sm font-medium">{label}</p>{chosen
    ? <div className="mt-1 flex items-center gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900"><RecordAvatar record={chosen} /><span className="min-w-0 flex-1 truncate">{recordTitle(chosen)}</span><button type="button" className="text-xs font-semibold underline" onClick={() => onChoose(null)}>Change</button></div>
    : <RecordPicker type={type} autoFocus={false} onPick={onChoose} />}</div>;
}
