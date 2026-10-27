"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { CRM_LABELS, type CrmPage, type CrmRecord, type CrmType } from "@/lib/crm/types";
import { ACTIVITIES, BUTTON, PRIMARY, INPUT, SINGLE, SourceBadge, ErrorMessage, Pager, useDateLabel, fetchJson, localInput, cleanSummary, ownerLabel, stageLabel, recordTitle } from "./shared";

const FilesPanel = dynamic(() => import("./WorkflowPanel").then(module => module.FilesPanel));

function TaskEditor({ record, email, canManage, onSaved }: { record: CrmRecord; email: string; canManage: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (!canManage && record.owner_email !== email) return <p className="mt-3 text-xs text-slate-500">Assigned to {record.owner_email || "an unmapped HubSpot owner"}. The task owner or management can update it.</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, version: record.version, status: form.get("status"), dueAt: new Date(String(form.get("due"))).toISOString(), reminderEnabled: form.get("reminderEnabled") === "on", reminderMinutes: Number(form.get("reminderMinutes") || 60) }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not update task")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
    <h3 className="font-semibold text-slate-800">Follow-up task</h3><ErrorMessage error={error} />
    <label className="block text-sm">Status<select name="status" defaultValue={record.effective_task_status || "open"} className={INPUT}><option value="open">Open</option><option value="completed">Completed</option></select></label>
    <label className="block text-sm">Due date and time<input type="datetime-local" name="due" required defaultValue={record.effective_due_at ? localInput(new Date(record.effective_due_at)) : ""} className={INPUT} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reminderEnabled" defaultChecked={record.reminder_enabled ?? false} />Email reminders to the task owner</label>
    <label className="block text-xs text-slate-600">Remind before due<select name="reminderMinutes" defaultValue={record.reminder_minutes ?? 60} className={INPUT}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label>
    <p className="text-xs text-slate-500">One reminder before due and one when overdue. Imported tasks start with reminders off.</p>
    <button className={PRIMARY} disabled={busy}>{busy ? "Saving..." : "Update task"}</button>
  </form>;
}

export default function RecordDetail({ id, email, canManage, onSelect, onAdd, onClose, onChanged, preview }: {
  id: string; email: string; canManage: boolean; preview?: CrmRecord; onSelect: (id: string) => void; onAdd: (type: CrmType, related: CrmRecord) => void; onClose: () => void; onChanged: () => void;
}) {
  const dateLabel = useDateLabel();
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedType, setRelatedType] = useState("activities");
  const [editing, setEditing] = useState(false);
  const { data: record, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}&view=detail`, fetchJson, { fallbackData: preview });
  const { data: related, error: relatedError, mutate: refreshRelated } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(id)}&type=${relatedType}&page=${relatedPage}&status=all`, fetchJson);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const objectIds: Record<CrmType, string> = { contacts: "0-1", companies: "0-2", deals: "0-3", tickets: "0-5", calls: "0-48", meetings: "0-47", emails: "0-49", notes: "0-46", tasks: "0-27" };
  return <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Record details">
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3"><button onClick={onClose} className="min-h-10 text-sm font-semibold text-cyan-800 hover:underline">← Back to records</button><div className="flex items-center gap-3 text-xs text-slate-500">{record && <><span>{SINGLE[record.object_type]}</span><SourceBadge source={record.source} /></>}</div></div>
    <ErrorMessage error={error} />{!record && !error && <p role="status" className="p-8 text-sm text-slate-500">Loading record...</p>}
    {record && <div className="grid items-start lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_15rem]">
      <aside className="min-w-0 space-y-5 p-5 lg:border-r lg:border-slate-200" aria-label="About this record">
        <div><div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-cyan-50 text-xl font-bold text-cyan-800">{record.title.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}</div><h2 className="break-words text-2xl font-bold tracking-tight text-slate-900">{recordTitle(record)}</h2>{record.archived && <p className="mt-2 text-xs font-semibold text-red-700">Archived record</p>}<p className="mt-2 break-words text-sm text-slate-500">{record.view_fields?.company || cleanSummary(record.summary)}</p></div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-4"><h3 className="text-sm font-bold text-slate-800">About this {SINGLE[record.object_type].toLowerCase()}</h3>{record.object_type === "contacts" && !record.archived && <button className="min-h-9 text-sm font-semibold text-cyan-800 hover:underline" onClick={() => setEditing(true)}>Edit</button>}</div>
        <dl className="space-y-4 text-sm">{[["Email", record.view_fields?.email], ["Phone", record.view_fields?.phone], ["Company", record.view_fields?.company], ["Lifecycle stage", stageLabel(record.view_fields?.stage)], ["Record owner", ownerLabel(record.owner_email)], ["Created", dateLabel(record.occurred_at)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value || "Not set"}</dd></div>)}</dl>
        <details onToggle={event => setFieldsOpen(event.currentTarget.open)} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">All saved fields</summary>{fieldsOpen && <SavedFields id={id} />}</details>
        {record.source === "hubspot" && <><details onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold text-slate-700">Original property history</summary>{historyOpen && <SavedHistory id={id} />}</details><a className="inline-block text-xs font-semibold text-cyan-800 underline" href={`https://app.hubspot.com/contacts/${record.portal_id}/record/${objectIds[record.object_type]}/${record.hubspot_id}`} target="_blank" rel="noreferrer">Open original in HubSpot</a></>}
      </aside>
      <section className="min-w-0 bg-slate-50 p-4 sm:p-5" aria-label="Customer activity">
        {!record.archived && <div className="mb-5 flex flex-wrap gap-2">{ACTIVITIES.map(type => <button key={type} onClick={() => onAdd(type, record)} className={type === "tasks" ? PRIMARY : BUTTON}>{type === "tasks" ? "+ Task" : type === "notes" ? "+ Note" : `Log ${SINGLE[type].toLowerCase()}`}</button>)}</div>}
        {record.body && <article className="mb-5 rounded-xl border border-slate-200 bg-white p-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-800">{SINGLE[record.object_type]} details</h3><span className="text-xs text-slate-500">{dateLabel(record.occurred_at)}</span></div><div className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{record.body}</div></article>}
        {record.object_type === "tasks" && !record.archived && <TaskEditor key={`${record.id}:${record.version}`} record={record} email={email} canManage={canManage} onSaved={() => { void mutate(); onChanged(); }} />}
        <div className="mt-4 flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-slate-900">Activity</h3><button className="min-h-9 text-xs font-semibold text-cyan-800 underline" onClick={() => { void refreshRelated(); }}>Refresh activity</button></div>
        <div role="tablist" aria-label="Activity types" className="mt-2 flex gap-1 overflow-x-auto border-b border-slate-200">{["activities", ...ACTIVITIES].map(type => <button role="tab" aria-selected={relatedType === type} key={type} onClick={() => { setRelatedType(type); setRelatedPage(0); }} className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-xs font-semibold ${relatedType === type ? "border-cyan-700 text-cyan-800" : "border-transparent text-slate-500"}`}>{type === "activities" ? "All activity" : CRM_LABELS[type as CrmType]}</button>)}</div>
        <ErrorMessage error={relatedError} />
        {!related && !relatedError && <p role="status" className="py-6 text-sm text-slate-500">Loading activity...</p>}
        <div className="mt-4 space-y-3">{related?.records.map(item => <TimelineItem key={item.id} record={item} onSelect={onSelect} />)}{related?.total === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="text-sm font-semibold text-slate-700">No {relatedType === "activities" ? "activity" : relatedType} yet</p><p className="mt-2 text-xs text-slate-500">Log a conversation, add a note, or schedule the next follow-up.</p></div>}</div>
        {related && related.total > 50 && <Pager page={relatedPage} total={related.total} onPage={setRelatedPage} />}
      </section>
      <aside className="min-w-0 space-y-5 border-t border-slate-200 p-5 lg:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0" aria-label="Associated records">
        <RelatedCards id={id} onSelect={onSelect} />
        <details onToggle={event => setFilesOpen(event.currentTarget.open)} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Attachments & recordings</summary>{filesOpen && <FilesPanel recordId={id} />}</details>
      </aside>
      {editing && <ContactEditor record={record} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void mutate(); onChanged(); }} />}
    </div>}
  </section>;
}


// Keep source blobs out of the normal detail request and render tree. They are
// fetched only when the corresponding disclosure is open, and SWR reuses a
// recently opened record rather than downloading it again on window focus.
const SOURCE_OPTIONS = { revalidateOnFocus: false, dedupingInterval: 60_000 };
function SavedFields({ id }: { id: string }) {
  const [search, setSearch] = useState("");
  const { data, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}&view=fields`, fetchJson, SOURCE_OPTIONS);
  const fields = useMemo(() => Object.entries(data?.properties ?? {}).filter(([key, value]) => value != null && value !== "" && `${key} ${String(value)}`.toLowerCase().includes(search.toLowerCase())), [data, search]);
  return <>
    <ErrorMessage error={error} />{error && <button onClick={() => void mutate()} className={BUTTON}>Retry fields</button>}
    {!data && !error && <p role="status" className="py-3 text-sm text-slate-500">Loading saved fields...</p>}
    {data && <><label className="mt-3 block text-xs text-slate-600">Find a field<input value={search} onChange={event => setSearch(event.target.value)} className={INPUT} placeholder="Project details, phone, owner..." /></label><dl className="mt-3 max-h-96 divide-y divide-slate-100 overflow-auto">{fields.map(([key, value]) => <div key={key} className="py-2 text-xs"><dt className="font-semibold text-slate-500">{key.replaceAll("_", " ")}</dt><dd className="mt-1 whitespace-pre-wrap break-all text-slate-800">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></>}
  </>;
}
function SavedHistory({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}&view=history`, fetchJson, SOURCE_OPTIONS);
  const history = useMemo(() => data ? JSON.stringify(Object.fromEntries(Object.entries(data.property_history ?? {}).filter(([, value]) => Array.isArray(value) && value.length)), null, 2) : "", [data]);
  return <>
    <p className="my-2 text-xs text-slate-500">Source changes retained from HubSpot.</p>
    <ErrorMessage error={error} />{error && <button onClick={() => void mutate()} className={BUTTON}>Retry history</button>}
    {!data && !error && <p role="status" className="py-3 text-sm text-slate-500">Loading original history...</p>}
    {data && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-[11px]">{history}</pre>}
  </>;
}

function TimelineItem({ record, onSelect }: { record: CrmRecord; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const dateLabel = useDateLabel();
  const { data, error } = useSWR<CrmRecord>(expanded ? `/api/crm?id=${encodeURIComponent(record.id)}&view=detail` : null, fetchJson, SOURCE_OPTIONS);
  return <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{SINGLE[record.object_type]}</span><span className="text-xs text-slate-500">{ownerLabel(record.owner_email)}</span></div><span className="text-xs text-slate-500">{dateLabel(record.object_type === "tasks" ? record.effective_due_at : record.occurred_at)}</span></div><div className="p-4"><button className="text-left text-sm font-semibold text-cyan-800 hover:underline" onClick={() => onSelect(record.id)}>{recordTitle(record)}</button>{record.object_type === "tasks" && <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{record.effective_task_status === "completed" ? "Completed" : "Open"}</span>}<p className={`${expanded ? "max-h-96 overflow-auto whitespace-pre-wrap" : "line-clamp-3"} mt-2 break-words text-sm leading-relaxed text-slate-600`}>{expanded ? data?.body || (data ? "No additional details." : "Loading details...") : record.view_fields?.preview || cleanSummary(record.summary)}</p><ErrorMessage error={error} /><button onClick={() => setExpanded(!expanded)} className="mt-3 min-h-8 text-xs font-semibold text-cyan-800 hover:underline">{expanded ? "Collapse" : "View details"}</button></div></article>;
}
function RelatedCards({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const { data, error } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(id)}&type=relationships&page=0`, fetchJson);
  return <><ErrorMessage error={error} />{(["contacts", "companies", "deals", "tickets"] as const).map(type => { const records = data?.records.filter(record => record.object_type === type) ?? []; return <section key={type}><h3 className="mb-3 text-sm font-bold text-slate-800">{CRM_LABELS[type]} <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{data ? records.length : "..."}</span></h3>{records.map(record => <button key={record.id} onClick={() => onSelect(record.id)} className="mb-2 block w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"><p className="truncate text-sm font-semibold text-cyan-800">{recordTitle(record)}</p><p className="mt-1 truncate text-xs text-slate-500">{cleanSummary(record.summary)}</p></button>)}{data && !records.length && <p className="text-xs text-slate-400">No associated {type}</p>}</section>; })}{data && data.total > 50 && <p className="text-xs text-slate-500">Showing the 50 most recent associated records.</p>}</>;
}
function ContactEditor({ record, onClose, onSaved }: { record: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(["title", "email", "phone", "company", "stage"].map(key => [key, String(form.get(key) ?? "")]));
    try { await fetchJson("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "editContact", id: record.id, version: record.version, fields }) }); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Contact could not be saved")); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="edit-contact-title" className="w-[min(92vw,32rem)] rounded-xl p-0 shadow-2xl backdrop:bg-slate-950/40"><form onSubmit={submit} className="space-y-4 p-6"><h2 id="edit-contact-title" className="text-xl font-bold">Edit contact</h2><p className="text-xs text-slate-500">Your changes are saved in Tools. Original HubSpot fields remain in the record history.</p><ErrorMessage error={error} />{[["title", "Name"], ["email", "Email"], ["phone", "Phone"], ["company", "Company"]].map(([key, label]) => <label key={key} className="block text-sm font-medium">{label}<input name={key} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} required={key === "title"} maxLength={key === "phone" ? 60 : key === "email" ? 320 : 300} defaultValue={key === "title" ? record.title : record.view_fields?.[key] ?? ""} className={INPUT} /></label>)}<label className="block text-sm font-medium">Lifecycle stage<select name="stage" defaultValue={record.view_fields?.stage ?? ""} className={INPUT}><option value="">Not set</option>{[...new Set(["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "evangelist", "other", ...(record.view_fields?.stage ? [record.view_fields.stage] : [])])].map(value => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></label><div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className={BUTTON}>Cancel</button><button disabled={busy} className={PRIMARY}>{busy ? "Saving..." : "Save changes"}</button></div></form></dialog>;
}
