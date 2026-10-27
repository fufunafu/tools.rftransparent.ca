"use client";

import { useMemo, useState, type FormEvent } from "react";
import useSWR from "swr";
import { CRM_LABELS, CRM_TYPES, type CrmPage, type CrmRecord, type CrmType } from "@/lib/crm/types";
import { ACTIVITIES, BUTTON, PRIMARY, INPUT, SINGLE, SourceBadge, ErrorMessage, Pager, useDateLabel, fetchJson, localInput } from "./shared";

function TaskEditor({ record, email, canManage, onSaved }: { record: CrmRecord; email: string; canManage: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (!canManage && record.owner_email !== email) return <p className="mt-3 text-xs text-slate-500">Assigned to {record.owner_email || "an unmapped HubSpot owner"}. The task owner or management can update it.</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await fetchJson("/api/crm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, version: record.version, status: form.get("status"), dueAt: new Date(String(form.get("due"))).toISOString() }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not update task")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-3 rounded-xl bg-slate-50 p-4">
    <h3 className="font-semibold text-slate-800">Follow-up task</h3><ErrorMessage error={error} />
    <label className="block text-sm">Status<select name="status" defaultValue={record.effective_task_status || "open"} className={INPUT}><option value="open">Open</option><option value="completed">Completed</option></select></label>
    <label className="block text-sm">Due date and time<input type="datetime-local" name="due" required defaultValue={record.effective_due_at ? localInput(new Date(record.effective_due_at)) : ""} className={INPUT} /></label>
    <button className={PRIMARY} disabled={busy}>{busy ? "Saving..." : "Update task"}</button>
  </form>;
}

export default function RecordDetail({ id, email, canManage, onSelect, onAdd, onClose, onChanged, preview }: {
  id: string; email: string; canManage: boolean; preview?: CrmRecord; onSelect: (id: string) => void; onAdd: (type: CrmType, related: CrmRecord) => void; onClose: () => void; onChanged: () => void;
}) {
  const dateLabel = useDateLabel();
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedType, setRelatedType] = useState("all");
  const { data: record, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}&view=detail`, fetchJson, { fallbackData: preview });
  const { data: related, error: relatedError, mutate: refreshRelated } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(id)}&type=${relatedType}&page=${relatedPage}`, fetchJson);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const objectIds: Record<CrmType, string> = { contacts: "0-1", companies: "0-2", deals: "0-3", tickets: "0-5", calls: "0-48", meetings: "0-47", emails: "0-49", notes: "0-46", tasks: "0-27" };
  return <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Record details">
    <div className="flex justify-between border-b border-slate-200 px-5 py-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Record details</p><button onClick={onClose} className="text-sm font-medium text-slate-600 hover:text-slate-950">Close details</button></div>
    <div className="p-5"><ErrorMessage error={error} />{!record && !error && <p className="text-sm text-slate-500">Loading record...</p>}
      {record && <>
        <div className="flex items-center gap-2"><span className="text-xs font-medium text-slate-500">{SINGLE[record.object_type]}</span><SourceBadge source={record.source} />{record.archived && <span className="text-xs text-red-700">Archived</span>}</div>
        <h2 className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900">{record.title}</h2>
        <p className="mt-2 break-words text-sm text-slate-600">{record.summary}</p>
        <p className="mt-2 text-xs text-slate-500">{dateLabel(record.occurred_at)}{record.owner_email ? ` · ${record.owner_email}` : ""}</p>
        {record.source === "hubspot" && <a className="mt-3 inline-block text-xs font-semibold text-orange-800 underline" href={`https://app.hubspot.com/contacts/${record.portal_id}/record/${objectIds[record.object_type]}/${record.hubspot_id}`} target="_blank" rel="noreferrer">Open original in HubSpot</a>}
        {!record.archived && <div className="my-5 flex flex-wrap gap-2">{ACTIVITIES.map(type => <button key={type} onClick={() => onAdd(type, record)} className={BUTTON}>{type === "tasks" ? "+ Task" : `+ ${SINGLE[type]}`}</button>)}</div>}
        {record.body && <div className="my-5 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 p-4 text-sm leading-relaxed text-slate-700">{record.body}</div>}
        {record.object_type === "tasks" && !record.archived && <TaskEditor key={`${record.id}:${record.version}`} record={record} email={email} canManage={canManage} onSaved={() => { void mutate(); onChanged(); }} />}
        <div className="mt-6 flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Timeline & related records</h3><button className="text-xs text-slate-500 underline" onClick={() => { void refreshRelated(); }}>Refresh</button></div>
        <label className="mt-3 block text-xs text-slate-600">Show<select value={relatedType} onChange={event => { setRelatedType(event.target.value); setRelatedPage(0); }} className={INPUT}><option value="all">All related records</option><option value="activities">Activities</option>{CRM_TYPES.map(type => <option key={type} value={type}>{CRM_LABELS[type]}</option>)}</select></label>
        <ErrorMessage error={relatedError} />
        <div className="mt-3 divide-y divide-slate-100">{related?.records.map(item => <button key={item.id} onClick={() => onSelect(item.id)} className="block w-full py-3 text-left hover:bg-slate-50"><div className="flex items-center gap-2 text-[11px] text-slate-500"><span>{SINGLE[item.object_type]}</span><SourceBadge source={item.source} /></div><p className="mt-1 truncate text-sm font-semibold text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(item.object_type === "tasks" ? item.effective_due_at : item.occurred_at)}</p></button>)}{related?.total === 0 && <p className="py-5 text-sm text-slate-500">No related records yet. Add a note, conversation, or follow-up above.</p>}</div>
        {related && related.total > 50 && <Pager page={relatedPage} total={related.total} onPage={setRelatedPage} />}
        <details onToggle={event => setFieldsOpen(event.currentTarget.open)} className="mt-6 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">All saved fields</summary>{fieldsOpen && <SavedFields id={id} />}</details>
        {record.source === "hubspot" && <details onToggle={event => setHistoryOpen(event.currentTarget.open)} className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Original property history</summary>{historyOpen && <SavedHistory id={id} />}</details>}
      </>}
    </div>
  </aside>;
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
