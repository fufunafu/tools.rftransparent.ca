"use client";

import { useState } from "react";
import useSWR from "swr";
import type { CrmPage } from "@/lib/crm/types";
import type { CaptureReview, CrmAsset, DuplicateGroup, WorkflowStatus } from "@/lib/crm/workflow-types";
import { BUTTON, INPUT, PRIMARY, ErrorMessage, fetchJson, useDateLabel } from "./shared";

export const WORKFLOW_LABELS: Record<string, string> = { reminders: "My reminders", duplicates: "Duplicate review", capture: "Activity review", files: "Files & recordings" };
const OPTIONS = { refreshInterval: 60000, revalidateOnFocus: false };
const post = (body: unknown) => fetchJson("/api/crm/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function WorkflowPanel({ view, canManage, onSelect }: { view: string; canManage: boolean; onSelect: (id: string) => void }) {
  const dateLabel = useDateLabel();
  const { data, error } = useSWR<WorkflowStatus>("/api/crm/workflows", fetchJson, OPTIONS);
  return <section className="min-w-0 space-y-5" aria-label={WORKFLOW_LABELS[view]}>
    <ErrorMessage error={error} />
    {view !== "reminders" && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
      {data && <><p>Background update: {data.latestRun ? `${dateLabel(data.latestRun.finished_at || data.latestRun.started_at)} · ${data.latestRun.status}` : "Waiting for the first scheduled run"}</p>
        {data.pendingIndex > 0 && <p className="mt-1">Preparing {data.pendingIndex.toLocaleString()} records for matching and file migration. {data.contactIndexPending > 0 ? "Customer matching starts when the contact index is ready." : "The contact index is ready."}</p>}</>}
    </div>}
    {view === "duplicates" && <DuplicateReview onSelect={onSelect} />}
    {view === "capture" && <ActivityReview onSelect={onSelect} startedAt={data?.capture?.started_at} />}
    {view === "reminders" && <Reminders onSelect={onSelect} configured={data?.remindersConfigured} />}
    {view === "files" && <FilesPanel canManage={canManage} configured={data?.filesConfigured} counts={data?.assets} />}
  </section>;
}

function ListNavigation({ page, hasNext, onPage }: { page: number; hasNext: boolean; onPage: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3 pt-3 text-xs text-slate-500"><button className={BUTTON} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className={BUTTON} disabled={!hasNext} onClick={() => onPage(page + 1)}>Next</button></div>;
}

function DuplicateReview({ onSelect }: { onSelect: (id: string) => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const { data, error, mutate } = useSWR<{ groups: DuplicateGroup[] }>(`/api/crm/workflows?view=duplicates&reviewed=${reviewed}&page=${page}`, fetchJson, OPTIONS);
  async function review(group: DuplicateGroup, decision: string) {
    setBusy(group.fingerprint); setActionError(null);
    try { await post({ action: "review_duplicate", kind: group.kind, value: group.value, fingerprint: group.fingerprint, decision }); await mutate(); }
    catch (cause) { setActionError(cause as Error); }
    finally { setBusy(null); }
  }
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-900">Possible duplicate contacts</h2>
    <p className="text-sm text-slate-600">These contacts share an email address or phone number. A shared business number can belong to different people. Review decisions keep every record and its history.</p>
    <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={reviewed} onChange={event => { setReviewed(event.target.checked); setPage(0); }} />Show reviewed groups</label>
    <ErrorMessage error={error || actionError} />{!data && !error && <p role="status">Loading possible duplicates...</p>}
    {data?.groups.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{reviewed ? "No reviewed groups yet." : "No duplicate groups awaiting review."}</p>}
    {data?.groups.map(group => <article key={`${group.kind}:${group.value}`} className="rounded-xl border border-slate-200 p-4">
      <p className="break-all text-sm font-semibold text-slate-900">Same {group.kind}: {group.value}</p><p className="mt-1 text-xs text-slate-500">{group.total} contacts{group.total > 20 ? "; first 20 shown" : ""}</p>
      <div className="my-3 divide-y divide-slate-100">{group.records.map(record => <button key={record.id} onClick={() => onSelect(record.id)} className="block w-full py-2 text-left text-sm text-orange-800 hover:underline"><span className="font-semibold">{record.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{record.summary}</span></button>)}</div>
      {group.decision ? <p className="mb-3 text-xs text-slate-600">Reviewed: {group.decision === "duplicate" ? "Confirmed duplicate; records retained" : "Keep as separate people"} · {group.reviewed_by}</p> : null}
      <div className="flex flex-wrap gap-2">{group.decision
        ? <button className={BUTTON} disabled={busy !== null} onClick={() => void review(group, "reopen")}>Reopen review</button>
        : <><button className={BUTTON} disabled={busy !== null} onClick={() => void review(group, "duplicate")}>Mark as duplicates</button><button className={BUTTON} disabled={busy !== null} onClick={() => void review(group, "separate")}>Keep separate</button></>}</div>
    </article>)}
    <ListNavigation page={page} hasNext={data?.groups.length === 30} onPage={setPage} />
  </div>;
}

function ActivityReview({ onSelect, startedAt }: { onSelect: (id: string) => void; startedAt?: string }) {
  const dateLabel = useDateLabel();
  const [page, setPage] = useState(0);
  const { data, error, mutate } = useSWR<{ events: CaptureReview[]; total: number }>(`/api/crm/workflows?view=activity&page=${page}`, fetchJson, OPTIONS);
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-900">Activity needing a customer match</h2>
    <p className="text-sm text-slate-600">New calls and shared inbox email previews link automatically when one contact matches. Choose the customer for unclear matches, or leave them out of the CRM.</p>
    <p className="text-xs text-slate-500">Capture {startedAt ? `started ${dateLabel(startedAt)}` : "is being prepared"}. Calls and previews appear after their existing source sync. Older activity remains in the imported HubSpot history.</p>
    <ErrorMessage error={error} />{!data && !error && <p role="status">Loading activity...</p>}
    {data?.total === 0 && <p className="py-8 text-center text-sm text-slate-500">No activity awaiting review.</p>}
    {data?.events.map(event => <ActivityCard key={`${event.id}:${event.revision}`} event={event} onSelect={onSelect} onSaved={() => void mutate()} />)}
    <ListNavigation page={page} hasNext={(page + 1) * 30 < (data?.total ?? 0)} onPage={setPage} />
  </div>;
}
function ActivityCard({ event, onSelect, onSaved }: { event: CaptureReview; onSelect: (id: string) => void; onSaved: () => void }) {
  const dateLabel = useDateLabel();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { data, error: searchError } = useSWR<CrmPage>(search.trim().length >= 2 ? `/api/crm?type=contacts&q=${encodeURIComponent(search.trim())}` : null, fetchJson);
  const contacts = [...new Map([...event.candidates, ...(data?.records ?? [])].map(record => [record.id, record])).values()];
  // A choice hidden by a new search is cleared rather than linked unseen.
  const chosen = contacts.some(contact => contact.id === selected) ? selected : "";
  async function save(contactId: string | null) {
    setBusy(true); setError(null);
    try { await post({ action: "review_activity", id: event.id, version: event.revision, contactId }); onSaved(); }
    catch (cause) { setError(cause as Error); } finally { setBusy(false); }
  }
  const p = event.payload;
  return <article className="space-y-3 rounded-xl border border-slate-200 p-4">
    <div><p className="text-sm font-semibold text-slate-900">{event.kind === "emails" ? String(p.subject || "Email preview") : `${p.direction === "outbound" ? "Outbound" : "Inbound"} call`}</p><p className="mt-1 text-xs text-slate-500">{dateLabel(event.occurred_at)} · {event.reason === "ambiguous_identity" ? "More than one matching customer" : event.reason === "missing_identity" ? "No usable email or phone" : "No matching customer"}</p></div>
    <p className="break-all text-xs text-slate-600">{String(p.from_email || p.from_number || "Unknown sender")} → {String(p.to_email || p.to_number || "Unknown recipient")}</p>
    {event.kind === "emails" && <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{String(p.snippet || "No email preview available.")}</p>}
    <label className="block text-xs font-medium text-slate-600">Find a contact<input className={INPUT} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" /></label>
    <label className="block text-xs font-medium text-slate-600">Link to<select className={INPUT} value={chosen} onChange={e => setSelected(e.target.value)}><option value="">Choose a customer</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.title} · {contact.summary}</option>)}</select></label>
    {chosen && <button onClick={() => onSelect(chosen)} className="text-xs text-orange-800 underline">Review this customer</button>}
    <ErrorMessage error={error || searchError} /><div className="flex flex-wrap gap-2"><button className={PRIMARY} disabled={busy || !chosen} onClick={() => void save(chosen)}>Link activity</button><button className={BUTTON} disabled={busy} onClick={() => void save(null)}>Leave out of CRM</button></div>
  </article>;
}

function Reminders({ onSelect, configured }: { onSelect: (id: string) => void; configured?: boolean }) {
  const dateLabel = useDateLabel();
  const [page, setPage] = useState(0);
  const { data, error } = useSWR<{ tasks: { id: string; title: string; effective_due_at: string; reminder_minutes: number }[]; deliveries: { id: string; record_id: string; title: string; kind: string; status: string; error_code: string | null; sent_at: string | null; created_at: string }[] }>(`/api/crm/workflows?view=reminders&page=${page}`, fetchJson, OPTIONS);
  return <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-bold text-slate-900">Your task reminders</h2>
    <p className="text-sm text-slate-600">Email reminders go to the task owner before the due time and once when overdue. Completing or rescheduling a task updates its reminders. Existing HubSpot tasks start with reminders off.</p>
    {configured === false && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Email delivery needs configuration. Your tasks are saved, but reminder emails cannot be sent yet.</p>}
    <ErrorMessage error={error} />{!data && !error && <p role="status">Loading reminders...</p>}
    {data?.tasks.length === 0 && <p className="py-6 text-sm text-slate-500">No open tasks with reminders enabled. Enable email reminders when scheduling or editing a task.</p>}
    <div className="divide-y divide-slate-100">{data?.tasks.map(task => <button key={task.id} onClick={() => onSelect(task.id)} className="block w-full py-3 text-left"><p className="text-sm font-semibold text-orange-800">{task.title}</p><p className="mt-1 text-xs text-slate-500">Due {dateLabel(task.effective_due_at)} · Remind {task.reminder_minutes === 1440 ? "1 day" : task.reminder_minutes === 60 ? "1 hour" : "15 minutes"} before</p></button>)}</div>
    <ListNavigation page={page} hasNext={data?.tasks.length === 30} onPage={setPage} />
    <h3 className="border-t border-slate-200 pt-4 text-sm font-semibold text-slate-900">Recent delivery status</h3>
    <div className="divide-y divide-slate-100">{data?.deliveries.map(item => <button key={item.id} onClick={() => onSelect(item.record_id)} className="block w-full py-3 text-left text-sm"><p className="font-medium text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.kind === "upcoming" ? "Before due" : "Overdue"} · {item.status === "sent" ? "Sent" : item.status === "failed" ? "Delivery needs attention" : item.status === "cancelled" ? "Cancelled after task or owner changed" : "Waiting for delivery"} · {dateLabel(item.sent_at || item.created_at)}</p></button>)}{data?.deliveries.length === 0 && <p className="text-sm text-slate-500">No reminders sent yet.</p>}</div>
  </div>;
}

const FILE_ERRORS: Record<string, string> = { hubspot_file_access: "Needs HubSpot file permission", source_missing: "Source file is unavailable", file_too_large: "Larger than the 50 MB copy limit", unsupported_source: "Source needs manual review", recording_access: "Recording requires additional access", size_mismatch: "Download was incomplete; retry queued", storage_verification: "Stored copy did not verify; retry queued", copy_interrupted: "Copy was interrupted; use Retry to queue it again" };
export function FilesPanel({ recordId, canManage = false, configured, counts }: { recordId?: string; canManage?: boolean; configured?: boolean; counts?: WorkflowStatus["assets"] }) {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const { data, error, mutate } = useSWR<{ files: CrmAsset[]; total: number }>(`/api/crm/workflows?view=files&page=${page}&status=${status}${recordId ? `&record=${encodeURIComponent(recordId)}` : ""}`, fetchJson, OPTIONS);
  async function retry() {
    setBusy(true); setActionError(null);
    try { await post({ action: "retry_files" }); await mutate(); } catch (cause) { setActionError(cause as Error); } finally { setBusy(false); }
  }
  return <div className={`space-y-4 ${recordId ? "pt-4" : "rounded-2xl border border-slate-200 bg-white p-5"}`}>
    {!recordId && <><h2 className="text-lg font-bold text-slate-900">Files & call recordings</h2><p className="text-sm text-slate-600">Copied files are stored privately in Tools and verified before they become downloadable. Keep HubSpot available while files remain pending or blocked.</p>
      {counts && <div className="flex flex-wrap gap-2">{counts.map(count => <span key={count.status} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{count.total.toLocaleString()} {count.status === "ready" ? "copied" : count.status}</span>)}</div>}
      {configured === false && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Background file copying needs the HubSpot connection. File references and previously copied files remain available.</p>}</>}
    <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-600">File status<select className={INPUT} value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All files</option><option value="ready">Copied</option><option value="pending">Pending</option><option value="copying">Copying</option><option value="blocked">Needs access or review</option><option value="failed">Retry needed</option></select></label>{canManage && !recordId && <button className={BUTTON} disabled={busy || !configured} onClick={() => void retry()}>{busy ? "Queuing..." : "Retry after access is fixed"}</button>}</div>
    <ErrorMessage error={error || actionError} />{!data && !error && <p role="status">Loading file references...</p>}
    {data?.total === 0 && <p className="py-4 text-sm text-slate-500">No files in this view.</p>}
    <div className="divide-y divide-slate-100">{data?.files.map(file => <div key={file.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-slate-800">{file.filename || (file.kind === "recording" ? "Call recording" : `HubSpot file ${file.id.split(":").at(-1)}`)}</p><p className="mt-1 text-xs text-slate-500">{file.status === "ready" ? `Copied and verified · ${((file.byte_size ?? 0) / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB` : file.error_code ? FILE_ERRORS[file.error_code] || "Copy paused; saved progress retained" : file.status === "copying" ? "Copying..." : "Waiting to copy"}</p></div>{file.status === "ready" && <a className={BUTTON} href={`/api/crm/files?id=${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer">Download</a>}</div>)}</div>
    <ListNavigation page={page} hasNext={(page + 1) * 30 < (data?.total ?? 0)} onPage={setPage} />
  </div>;
}
