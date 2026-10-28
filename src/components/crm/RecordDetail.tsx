"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import RecordAvatar from "./RecordAvatar";
import DirectoryEditor from "./DirectoryEditor";
import RecordChangeHistory from "./RecordChangeHistory";
import AssociationsPanel from "./AssociationsPanel";
import ContactPoint from "./ContactPoints";
import DeleteRecord from "./DeleteRecord";
import FollowupSummary from "./FollowupSummary";
import QuickComplete from "./QuickComplete";
import TaskPanel from "./TaskPanel";
import { CRM_LABELS, type CrmPage, type CrmRecord, type CrmType } from "@/lib/crm/types";
import { recordLocation } from "@/lib/crm/directory";
import { activityChips, canEditActivity, deletedInfo, EDITABLE_ACTIVITIES } from "@/lib/crm/productivity";
import { crmAction } from "./actions";
import { ACTIVITIES, BUTTON, INPUT, PRIMARY, SINGLE, SourceBadge, ErrorMessage, Pager, useDateLabel, fetchJson, cleanSummary, ownerLabel, stageLabel, recordTitle, useNow } from "./shared";

const FilesPanel = dynamic(() => import("./WorkflowPanel").then(module => module.FilesPanel));
const ActivityEditor = dynamic(() => import("./ActivityEditor"));

export default function RecordDetail({ id, email, canManage, onSelect, onAdd, onClose, onChanged, preview }: {
  id: string; email: string; canManage: boolean; preview?: CrmRecord; onSelect: (id: string) => void; onAdd: (type: CrmType, related: CrmRecord) => void; onClose: () => void; onChanged: () => void;
}) {
  const dateLabel = useDateLabel();
  const now = useNow();
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedType, setRelatedType] = useState("activities");
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CrmRecord | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const { data: record, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(id)}&view=detail`, fetchJson, { fallbackData: preview });
  const { data: related, error: relatedError, mutate: refreshRelated } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(id)}&type=${relatedType}&page=${relatedPage}&status=all${showDeleted ? "&archived=true" : ""}`, fetchJson);
  const directory = record?.object_type === "contacts" || record?.object_type === "companies";
  const { data: upcoming, mutate: refreshUpcoming } = useSWR<CrmPage>(directory ? `/api/crm?related=${encodeURIComponent(id)}&type=tasks&page=0&status=open` : null, fetchJson);
  const { data: pin, mutate: refreshPin } = useSWR<{ pinned: CrmRecord | null }>(directory ? `/api/crm/associations?pin=${encodeURIComponent(id)}` : null, fetchJson);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const objectIds: Record<CrmType, string> = { contacts: "0-1", companies: "0-2", deals: "0-3", tickets: "0-5", calls: "0-48", meetings: "0-47", emails: "0-49", notes: "0-46", tasks: "0-27" };
  function refreshAll() { void mutate(); void refreshRelated(); void refreshUpcoming(); void refreshPin(); onChanged(); }
  async function setPin(activityId: string | null) {
    setActionError(null);
    try { await crmAction({ action: "pin", recordId: id, activityId }); void refreshPin(); }
    catch (cause) { setActionError(cause instanceof Error ? cause : new Error("Could not update the pinned activity")); }
  }
  const upcomingTasks = useMemo(() => [...(upcoming?.records ?? [])].sort((a, b) => Date.parse(a.effective_due_at ?? "9999") - Date.parse(b.effective_due_at ?? "9999")).slice(0, 5), [upcoming]);
  const pinned = pin?.pinned ?? null;
  return <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Record details">
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3"><button onClick={onClose} className="min-h-10 text-sm font-semibold text-cyan-800 hover:underline">← Back to records</button><div className="flex items-center gap-3 text-xs text-slate-500">{record && <><span>{SINGLE[record.object_type]}</span><SourceBadge source={record.source} />{!record.archived && <DeleteRecord record={record} email={email} canManage={canManage} onChanged={refreshAll} />}</>}</div></div>
    <ErrorMessage error={error} />{!record && !error && <p role="status" className="p-8 text-sm text-slate-500">Loading record...</p>}
    {record && <div className="grid items-start lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_16rem]">
      <aside className="min-w-0 space-y-5 p-5 lg:border-r lg:border-slate-200" aria-label="About this record">
        <div><div className="mb-3"><RecordAvatar record={record} size="large" /></div><h2 className="break-words text-2xl font-bold tracking-tight text-slate-900">{recordTitle(record)}</h2>{record.archived && !deletedInfo(record) && <p className="mt-2 text-xs font-semibold text-red-700">Archived record</p>}<p className="mt-2 break-words text-sm text-slate-500">{record.object_type === "contacts" ? record.view_fields?.company || cleanSummary(record.summary) : record.object_type === "companies" ? record.view_fields?.domain : ""}</p>
          {activityChips(record).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{activityChips(record).map(chip => <span key={chip} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{chip}</span>)}</div>}</div>
        {record.archived && <DeleteRecord record={record} email={email} canManage={canManage} onChanged={refreshAll} />}
        {directory && !record.archived && <FollowupSummary key={`${id}:${record.version}`} id={id} onSelect={onSelect} />}
        <div className="flex items-center justify-between border-t border-slate-200 pt-4"><h3 className="text-sm font-bold text-slate-800">About this {SINGLE[record.object_type].toLowerCase()}</h3>{directory && !record.archived && <button className="min-h-9 text-sm font-semibold text-cyan-800 hover:underline" onClick={() => setEditing(true)}>Edit</button>}{canEditActivity(record, email, canManage) && <button className="min-h-9 text-sm font-semibold text-cyan-800 hover:underline" onClick={() => setEditingActivity(record)}>Edit</button>}</div>
        <AboutFields record={record} />
        <details onToggle={event => setFieldsOpen(event.currentTarget.open)} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">All saved fields</summary>{fieldsOpen && <SavedFields id={id} />}</details>
        {record.source === "hubspot" && <><details onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold text-slate-700">Original property history</summary>{historyOpen && <SavedHistory id={id} />}</details><a className="inline-block text-xs font-semibold text-cyan-800 underline" href={`https://app.hubspot.com/contacts/${record.portal_id}/record/${objectIds[record.object_type]}/${record.hubspot_id}`} target="_blank" rel="noreferrer">Open original in HubSpot</a></>}
      </aside>
      <section className="min-w-0 bg-slate-50 p-4 sm:p-5" aria-label="Customer activity">
        {!record.archived && <div className="mb-5 flex flex-wrap gap-2">{ACTIVITIES.map(type => <button key={type} onClick={() => onAdd(type, record)} className={type === "tasks" ? PRIMARY : BUTTON}>{type === "tasks" ? "+ Task" : type === "notes" ? "+ Note" : `Log ${SINGLE[type].toLowerCase()}`}</button>)}</div>}
        <ErrorMessage error={actionError} />
        {record.body && !(record.object_type === "tasks" && record.source === "tools" && !record.archived) && <article className="mb-5 rounded-xl border border-slate-200 bg-white p-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-800">{SINGLE[record.object_type]} details</h3><span className="text-xs text-slate-500">{dateLabel(record.occurred_at)}</span></div><div className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{record.body}</div></article>}
        {record.object_type === "tasks" && !record.archived && <TaskPanel key={`${record.id}:${record.version}`} record={record} email={email} canManage={canManage} onSaved={refreshAll} />}
        {directory && upcomingTasks.length > 0 && <section aria-label="Upcoming tasks" className="mb-5 rounded-xl border border-orange-200 bg-white"><h3 className="border-b border-orange-100 px-4 py-3 text-sm font-bold text-slate-800">Upcoming tasks <span className="ml-1 text-xs font-normal text-slate-500">{upcoming?.total ?? 0} open</span></h3><div className="divide-y divide-slate-100">{upcomingTasks.map(task => { const late = now > 0 && task.effective_due_at && Date.parse(task.effective_due_at) < now; return <div key={task.id} className="flex items-center gap-3 px-4 py-3"><QuickComplete record={task} email={email} canManage={canManage} onChanged={refreshAll} onError={setActionError} /><button onClick={() => onSelect(task.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold text-cyan-800 hover:underline">{recordTitle(task)}</span><span className="mt-0.5 block text-xs text-slate-500"><span className="capitalize">{ownerLabel(task.owner_email)}</span>{activityChips(task).length ? ` · ${activityChips(task).join(" · ")}` : ""}</span></button><span className={`shrink-0 text-xs ${late ? "font-semibold text-red-700" : "text-slate-500"}`}>{late ? "Overdue · " : ""}{dateLabel(task.effective_due_at)}</span></div>; })}</div></section>}
        {pinned && <section aria-label="Pinned activity" className="mb-5"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800">Pinned</p><TimelineItem record={pinned} email={email} canManage={canManage} pinned onPin={() => void setPin(null)} onSelect={onSelect} onEdit={setEditingActivity} onChanged={refreshAll} onError={setActionError} /></section>}
        <details onToggle={event => setChangesOpen(event.currentTarget.open)} className="my-4 rounded-lg border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Change history</summary>{changesOpen && <RecordChangeHistory key={record.version} id={id} />}</details>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold text-slate-900">{showDeleted ? "Deleted activity" : "Activity"}</h3><div className="flex items-center gap-3"><button className="min-h-9 text-xs font-semibold text-slate-500 underline" aria-pressed={showDeleted} onClick={() => { setShowDeleted(!showDeleted); setRelatedPage(0); }}>{showDeleted ? "Back to activity" : "Show deleted"}</button><button className="min-h-9 text-xs font-semibold text-cyan-800 underline" onClick={() => { void refreshRelated(); }}>Refresh activity</button></div></div>
        <div role="tablist" aria-label="Activity types" className="mt-2 flex gap-1 overflow-x-auto border-b border-slate-200">{["activities", ...ACTIVITIES].map(type => <button role="tab" aria-selected={relatedType === type} key={type} onClick={() => { setRelatedType(type); setRelatedPage(0); }} className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-xs font-semibold ${relatedType === type ? "border-cyan-700 text-cyan-800" : "border-transparent text-slate-500"}`}>{type === "activities" ? "All activity" : CRM_LABELS[type as CrmType]}</button>)}</div>
        <ErrorMessage error={relatedError} />
        {!related && !relatedError && <p role="status" className="py-6 text-sm text-slate-500">Loading activity...</p>}
        <div className="mt-4 space-y-3">{related?.records.map(item => <TimelineItem key={`${item.id}:${item.version}`} record={item} email={email} canManage={canManage} pinned={item.id === pinned?.id} onPin={directory && !record.archived && EDITABLE_ACTIVITIES.includes(item.object_type) && !item.archived ? () => void setPin(item.id === pinned?.id ? null : item.id) : undefined} onSelect={onSelect} onEdit={setEditingActivity} onChanged={refreshAll} onError={setActionError} />)}{related?.total === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="text-sm font-semibold text-slate-700">{showDeleted ? "No deleted activity" : `No ${relatedType === "activities" ? "activity" : relatedType} yet`}</p>{!showDeleted && <p className="mt-2 text-xs text-slate-500">Log a conversation, add a note, or schedule the next follow-up.</p>}</div>}</div>
        {related && related.total > 50 && <Pager page={relatedPage} total={related.total} onPage={setRelatedPage} />}
      </section>
      <aside className="min-w-0 space-y-5 border-t border-slate-200 p-5 lg:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0" aria-label="Associated records">
        <AssociationsPanel record={record} onSelect={onSelect} onCreate={type => onAdd(type, record)} onChanged={refreshAll} />
        <details onToggle={event => setFilesOpen(event.currentTarget.open)} className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Attachments & recordings</summary>{filesOpen && <FilesPanel recordId={id} />}</details>
      </aside>
      {editing && <DirectoryEditor record={record} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refreshAll(); }} />}
      {editingActivity && <ActivityEditor record={editingActivity} onClose={() => setEditingActivity(null)} onSaved={() => { setEditingActivity(null); refreshAll(); }} />}
    </div>}
  </section>;
}

/** The fields that matter for each kind of record, with one-tap contact actions. */
function AboutFields({ record }: { record: CrmRecord }) {
  const dateLabel = useDateLabel();
  const fields = record.view_fields ?? {};
  const rows: [string, ReactNode][] = record.object_type === "contacts" ? [
    ["Email", <ContactPoint key="email" kind="email" value={fields.email} />], ["Phone", <ContactPoint key="phone" kind="phone" value={fields.phone} />],
    ["Company", fields.company], ["Lifecycle stage", fields.stage_label || stageLabel(fields.stage)], ["Record owner", <span key="owner" className="capitalize">{ownerLabel(record.owner_email)}</span>],
    ["Location", recordLocation(fields)], ["Created", dateLabel(record.occurred_at)],
  ] : record.object_type === "companies" ? [
    ["Website", <ContactPoint key="website" kind="website" value={fields.website || fields.domain} />], ["Phone", <ContactPoint key="phone" kind="phone" value={fields.phone} />],
    ["Domain", fields.domain], ["Lifecycle stage", fields.stage_label || stageLabel(fields.stage)], ["Record owner", <span key="owner" className="capitalize">{ownerLabel(record.owner_email)}</span>],
    ["Address", [fields.address, recordLocation(fields), fields.postal_code].filter(Boolean).join(", ")], ["Created", dateLabel(record.occurred_at)],
  ] : record.object_type === "tasks" ? [
    ["Assigned to", <span key="owner" className="capitalize">{ownerLabel(record.owner_email)}</span>], ["Due", dateLabel(record.effective_due_at)],
    ["Status", record.effective_task_status === "completed" ? "Completed" : "Open"], ["Created by", record.created_by_email ? <span key="creator" className="capitalize">{ownerLabel(record.created_by_email)}</span> : "HubSpot import"],
  ] : [
    ["Logged by", <span key="owner" className="capitalize">{ownerLabel(record.owner_email)}</span>], ["Date", dateLabel(record.occurred_at)],
  ];
  return <dl className="space-y-4 text-sm">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value || "Not set"}</dd></div>)}</dl>;
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

function TimelineItem({ record, email, canManage, pinned = false, onPin, onSelect, onEdit, onChanged, onError }: {
  record: CrmRecord; email: string; canManage: boolean; pinned?: boolean; onPin?: () => void; onSelect: (id: string) => void; onEdit: (record: CrmRecord) => void; onChanged: () => void; onError: (error: Error) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dateLabel = useDateLabel();
  const now = useNow();
  const { data, error } = useSWR<CrmRecord>(expanded ? `/api/crm?id=${encodeURIComponent(record.id)}&view=detail` : null, fetchJson, SOURCE_OPTIONS);
  const chips = activityChips(record);
  const task = record.object_type === "tasks";
  const late = task && record.effective_task_status === "open" && now > 0 && record.effective_due_at && Date.parse(record.effective_due_at) < now;
  return <article className={`overflow-hidden rounded-lg border bg-white shadow-sm ${pinned ? "border-orange-300" : "border-slate-200"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{SINGLE[record.object_type]}</span>{chips.map(chip => <span key={chip} className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">{chip}</span>)}<span className="text-xs capitalize text-slate-500">{ownerLabel(record.owner_email)}</span></div><span className={`text-xs ${late ? "font-semibold text-red-700" : "text-slate-500"}`}>{late ? "Overdue · " : ""}{dateLabel(task ? record.effective_due_at : record.occurred_at)}</span></div>
    <div className="p-4"><div className="flex items-start gap-3">{task && !record.archived && <QuickComplete record={record} email={email} canManage={canManage} onChanged={onChanged} onError={onError} />}<div className="min-w-0 flex-1"><button className={`text-left text-sm font-semibold hover:underline ${task && record.effective_task_status === "completed" ? "text-slate-500 line-through" : "text-cyan-800"}`} onClick={() => onSelect(record.id)}>{recordTitle(record)}</button>
      <p className={`${expanded ? "max-h-96 overflow-auto whitespace-pre-wrap" : "line-clamp-3"} mt-2 break-words text-sm leading-relaxed text-slate-600`}>{expanded ? data?.body || (data ? "No additional details." : "Loading details...") : record.view_fields?.preview || cleanSummary(record.summary)}</p></div></div>
      <ErrorMessage error={error} />
      {record.archived ? <div className="mt-3"><DeleteRecord record={record} email={email} canManage={canManage} onChanged={onChanged} /></div>
        : <div className="mt-3 flex flex-wrap items-center gap-1"><button onClick={() => setExpanded(!expanded)} className="min-h-8 rounded px-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-50">{expanded ? "Collapse" : "View details"}</button>
          {canEditActivity(record, email, canManage) && <button onClick={() => onEdit(record)} className="min-h-8 rounded px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Edit</button>}
          {onPin && <button onClick={onPin} aria-pressed={pinned} className="min-h-8 rounded px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">{pinned ? "Unpin" : "Pin to top"}</button>}
          <DeleteRecord record={record} email={email} canManage={canManage} onChanged={onChanged} compact />
        </div>}
    </div>
  </article>;
}
