"use client";
import { useState } from "react";
import type { CrmRecord } from "@/lib/crm/types";
import { recordLocation } from "@/lib/crm/directory";
import { DIRECTORY_COLUMNS, type DirectoryColumn, type DirectoryType } from "@/lib/crm/directory-workflows";
import BulkDirectoryAction from "./BulkDirectoryAction";
import RecordAvatar from "./RecordAvatar";
import { BUTTON, PRIMARY, SourceBadge, ownerLabel, recordTitle, stageLabel, useDateLabel } from "./shared";

export default function DirectoryTable({ type, records, columns, email, busy, onSelect, onPreview, onChanged }: {
  type: DirectoryType; records: CrmRecord[]; columns: DirectoryColumn[]; email: string; busy: boolean;
  onSelect: (id: string) => void; onPreview: (record: CrmRecord) => void; onChanged: (count: number) => void;
}) {
  const [selection, setSelection] = useState<CrmRecord[]>([]), [bulkOpen, setBulkOpen] = useState(false);
  const dateLabel = useDateLabel();
  const eligible = records.filter(record => !record.archived);
  const selectedIds = new Set(selection.map(record => record.id));
  const allSelected = eligible.length > 0 && eligible.every(record => selectedIds.has(record.id));
  function toggle(record: CrmRecord) { setSelection(current => current.some(item => item.id === record.id) ? current.filter(item => item.id !== record.id) : [...current, record]); }
  function cell(record: CrmRecord, column: DirectoryColumn) {
    if (column === "owner") return <span className="capitalize" title={record.owner_email ?? ""}>{ownerLabel(record.owner_email)}</span>;
    if (column === "stage") return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{record.view_fields?.stage_label || stageLabel(record.view_fields?.stage)}</span>;
    if (column === "location") return recordLocation(record.view_fields) || "Not set";
    if (column === "added") return dateLabel(record.occurred_at);
    if (column === "lastContact") return record.followup_checked_at ? (record.last_contacted_at ? dateLabel(record.last_contacted_at) : "Never") : <span className="text-slate-400">Updating...</span>;
    if (column === "nextTask") {
      if (!record.followup_checked_at) return <span className="text-slate-400">Updating...</span>;
      return record.next_task_id ? <div><button className="block max-w-52 truncate text-left font-medium text-cyan-800 hover:underline" onClick={() => onSelect(record.next_task_id!)}>{record.next_task_title || "Follow-up"}</button><span className="mt-1 block text-xs">{record.next_task_due_at ? dateLabel(record.next_task_due_at) : "No due date"}{(record.open_task_count ?? 0) > 1 ? ` · +${record.open_task_count! - 1} open` : ""}</span></div> : <span className="text-slate-400">No open task</span>;
    }
    return record.view_fields?.[column] || (column === "domain" ? record.view_fields?.website : "") || "Not set";
  }
  return <>
    {selection.length > 0 && <div className="flex flex-wrap items-center gap-3 border-b border-orange-200 bg-orange-50 px-5 py-3" aria-label="Selected records"><p className="text-sm font-semibold text-orange-900">{selection.length} selected on this page</p><button disabled={busy} className={PRIMARY} onClick={() => setBulkOpen(true)}>Update selected</button><button className={BUTTON} disabled={busy} onClick={() => setSelection([])}>Clear selection</button></div>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th className="w-10 px-4 py-3"><input aria-label="Select all records on this page" type="checkbox" checked={allSelected} disabled={busy || !eligible.length} ref={input => { if (input) input.indeterminate = selection.length > 0 && !allSelected; }} onChange={event => setSelection(event.target.checked ? eligible : [])} /></th><th scope="col" className="min-w-56 px-3 py-3">Name</th>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3">{DIRECTORY_COLUMNS[column]}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map(record => <tr key={record.id} className={selectedIds.has(record.id) ? "bg-orange-50/60" : "hover:bg-slate-50"}><td className="px-4 py-3"><input aria-label={`Select ${recordTitle(record)}`} type="checkbox" checked={selectedIds.has(record.id)} disabled={busy || record.archived} onChange={() => toggle(record)} /></td><td className="min-w-56 max-w-80 px-3 py-3"><div className="flex items-center gap-3"><RecordAvatar record={record} /><div className="min-w-0 flex-1"><button onClick={() => onSelect(record.id)} className="block max-w-64 truncate text-left font-semibold text-cyan-800 hover:underline">{recordTitle(record)}</button><div className="mt-1 flex items-center gap-2"><button aria-label={`Preview ${recordTitle(record)}`} onClick={() => onPreview(record)} className="min-h-7 text-xs text-slate-500 hover:text-cyan-800 hover:underline">Preview</button>{record.source === "tools" && <SourceBadge source={record.source} />}</div></div></div></td>{columns.map(column => <td key={column} className="max-w-64 truncate whitespace-nowrap px-4 py-3 text-xs text-slate-600">{cell(record, column)}</td>)}</tr>)}</tbody></table></div>
    <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400">Last contacted uses linked calls, emails, and meetings. Follow-up summaries update in the background.</p>
    {bulkOpen && <BulkDirectoryAction type={type} records={selection} email={email} onClose={() => setBulkOpen(false)} onSaved={count => { setBulkOpen(false); setSelection([]); onChanged(count); }} />}
  </>;
}
