"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { CrmPage, CrmRecord, CrmType } from "@/lib/crm/types";
import { recordLocation } from "@/lib/crm/directory";
import DirectoryEditor from "./DirectoryEditor";
import RecordAvatar from "./RecordAvatar";
import ContactPoint from "./ContactPoints";
import { BUTTON, PRIMARY, ErrorMessage, fetchJson, ownerLabel, recordTitle, stageLabel, useDateLabel } from "./shared";

export default function RecordPreview({ record: initial, onClose, onOpen, onAdd, onChanged }: {
  record: CrmRecord; onClose: () => void; onOpen: (id: string) => void; onAdd: (type: CrmType, related: CrmRecord) => void; onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const dateLabel = useDateLabel();
  const { data: record = initial, error, mutate } = useSWR<CrmRecord>(`/api/crm?id=${encodeURIComponent(initial.id)}&view=summary`, fetchJson, { fallbackData: initial });
  const { data: activity, error: activityError } = useSWR<CrmPage>(`/api/crm?related=${encodeURIComponent(initial.id)}&type=activities&page=0&status=all`, fetchJson);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; dialog.current?.show(); close.current?.focus(); return () => prior?.focus(); }, []);
  return <dialog ref={dialog} aria-label="Record preview" onKeyDown={event => { if (event.key === "Escape" && !editing) { event.preventDefault(); event.stopPropagation(); onClose(); } }} className="fixed bottom-0 left-auto right-0 top-0 z-40 m-0 h-dvh max-h-none w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-0 shadow-2xl">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">{record.object_type === "companies" ? "Company" : "Contact"} preview</h2><button ref={close} onClick={onClose} className={BUTTON} aria-label="Close preview">Close ×</button></header>
    <div className="space-y-5 p-5"><ErrorMessage error={error} /><div className="flex items-center gap-3"><RecordAvatar record={record} size="large" /><h3 className="min-w-0 break-words text-xl font-bold text-slate-900">{recordTitle(record)}</h3></div><div className="flex flex-wrap gap-2"><button onClick={() => onOpen(record.id)} className={PRIMARY}>Open full record</button>{!record.archived && <button onClick={() => setEditing(true)} className={BUTTON}>Edit details</button>}</div>
      <dl className="space-y-3 text-sm">{([["Email", record.view_fields?.email, "email"], ["Phone", record.view_fields?.phone, "phone"], ["Company", record.view_fields?.company], ["Website", record.view_fields?.website || record.view_fields?.domain, "website"], ["Location", recordLocation(record.view_fields)], ["Owner", ownerLabel(record.owner_email)], ["Lifecycle stage", record.view_fields?.stage_label || stageLabel(record.view_fields?.stage)]] as [string, string | undefined, ("email" | "phone" | "website")?][]).filter(([, value]) => value).map(([label, value, kind]) => <div key={label}><dt className="text-xs font-medium text-slate-400">{label}</dt><dd className="mt-1 break-words text-slate-700">{kind ? <ContactPoint kind={kind} value={value} /> : value}</dd></div>)}</dl>
      {!record.archived && <div className="flex gap-2 border-t border-slate-200 pt-4"><button className={PRIMARY} onClick={() => onAdd("tasks", record)}>+ Task</button><button className={BUTTON} onClick={() => onAdd("notes", record)}>+ Note</button></div>}
      <section className="border-t border-slate-200 pt-4"><h4 className="mb-3 font-semibold text-slate-800">Recent activity</h4><ErrorMessage error={activityError} />{!activity && !activityError && <p role="status" className="text-xs text-slate-500">Loading activity...</p>}<div className="space-y-3">{activity?.records.slice(0, 8).map(item => <article key={item.id} className="rounded-lg border border-slate-200 p-3"><button onClick={() => onOpen(item.id)} className="text-left text-sm font-medium text-cyan-800 hover:underline">{recordTitle(item)}</button><p className="mt-1 text-xs text-slate-400">{item.object_type} · {dateLabel(item.object_type === "tasks" ? item.effective_due_at : item.occurred_at)}</p><p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-slate-600">{item.view_fields?.preview || item.summary}</p></article>)}</div>{activity?.total === 0 && <p className="text-xs text-slate-500">No linked activity yet.</p>}{(activity?.total ?? 0) > 8 && <button className="mt-3 text-xs font-semibold text-cyan-800 underline" onClick={() => onOpen(record.id)}>View all activity</button>}</section>
    </div>{editing && <DirectoryEditor record={record} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void mutate(); onChanged(); }} />}
  </dialog>;
}
