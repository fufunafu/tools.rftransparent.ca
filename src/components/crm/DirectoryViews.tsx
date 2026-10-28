"use client";
import { useState } from "react";
import useSWR from "swr";
import { availableColumns, DIRECTORY_COLUMNS, directoryViewSignature, type DirectoryColumn, type DirectoryType, type DirectoryViewConfig, type SavedDirectoryView } from "@/lib/crm/directory-workflows";
import { BUTTON, INPUT, PRIMARY, ErrorMessage, fetchJson } from "./shared";

export default function DirectoryViews({ type, config, onApply, onColumns }: {
  type: DirectoryType; config: DirectoryViewConfig; onApply: (config: DirectoryViewConfig) => void; onColumns: (columns: DirectoryColumn[]) => void;
}) {
  const { data, error: loadError, mutate } = useSWR<{ views: SavedDirectoryView[] }>(`/api/crm/directory?type=${type}`, fetchJson, { revalidateOnFocus: false });
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false), [editingName, setEditingName] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<Error | null>(null), [notice, setNotice] = useState("");
  const active = data?.views.find(view => view.id === activeId);
  const modified = active && directoryViewSignature(active.config) !== directoryViewSignature(config);
  async function save(update: boolean) {
    if (!name.trim()) { setError(new Error("Give this view a name.")); return; }
    setSaving(true); setError(null); setNotice("");
    const id = update && active ? active.id : crypto.randomUUID();
    try {
      await fetchJson("/api/crm/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "saveView", view: { id, version: update && active ? active.version : 0, type, name: name.trim(), config } }) });
      await mutate(); setActiveId(id); setEditingName(false); setNotice("View saved for your account.");
    } catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not save view")); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!active) return;
    setSaving(true); setError(null);
    try { await fetchJson("/api/crm/directory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: active.id, version: active.version }) }); await mutate(); setActiveId(""); setConfirmDelete(false); setNotice("Saved view deleted. Your current filters remain."); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error("Could not delete view")); }
    finally { setSaving(false); }
  }
  function move(column: DirectoryColumn, direction: -1 | 1) {
    const next = [...config.columns], from = next.indexOf(column), to = from + direction;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]]; onColumns(next);
  }
  return <div className="space-y-3 border-b border-slate-200 px-5 py-3">
    <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Saved views<select disabled={saving} aria-label="Saved views" value={active?.id ?? ""} onChange={event => { const selected = data?.views.find(view => view.id === event.target.value); setActiveId(selected?.id ?? ""); setConfirmDelete(false); setEditingName(false); setNotice(""); if (selected) onApply(selected.config); }} className="min-h-10 max-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700"><option value="">Current view</option>{data?.views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>{modified && <span className="text-xs text-amber-700">Modified</span>}<button disabled={saving} className={BUTTON} onClick={() => { setName(active?.name ?? ""); setEditingName(!editingName); setConfirmDelete(false); }}>Save view</button>{active && <button disabled={saving} className="min-h-10 px-2 text-xs text-slate-500 underline" onClick={() => { setConfirmDelete(!confirmDelete); setEditingName(false); }}>Delete view</button>}
      <details className="relative ml-auto"><summary className={`${BUTTON} flex cursor-pointer list-none items-center`}>Columns ({config.columns.length + 1})</summary><div className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[85vw] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><p className="mb-2 text-xs text-slate-500">Name stays visible. Choose and order other columns.</p><div className="max-h-80 overflow-auto">{[...config.columns, ...availableColumns(type).filter(column => !config.columns.includes(column))].map(column => <div key={column} className="flex min-h-10 items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={config.columns.includes(column)} onChange={event => onColumns(event.target.checked ? [...config.columns, column] : config.columns.filter(value => value !== column))} />{DIRECTORY_COLUMNS[column]}</label>{config.columns.includes(column) && <div className="flex"><button type="button" className="h-8 w-8 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25" disabled={config.columns.indexOf(column) === 0} aria-label={`Move ${DIRECTORY_COLUMNS[column]} left`} onClick={() => move(column, -1)}>←</button><button type="button" className="h-8 w-8 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25" disabled={config.columns.indexOf(column) === config.columns.length - 1} aria-label={`Move ${DIRECTORY_COLUMNS[column]} right`} onClick={() => move(column, 1)}>→</button></div>}</div>)}</div></div></details>
    </div>
    {(error || loadError) && <div><ErrorMessage error={error || loadError} />{loadError && <button className={BUTTON} onClick={() => void mutate()}>Retry saved views</button>}</div>}{notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    {editingName && <form onSubmit={event => { event.preventDefault(); void save(Boolean(active)); }} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"><label className="min-w-48 flex-1 text-xs font-medium text-slate-600">View name<input autoFocus required maxLength={80} value={name} disabled={saving} onChange={event => setName(event.target.value)} className={INPUT} placeholder="For example, Ontario customers" /></label><button disabled={saving} className={PRIMARY}>{saving ? "Saving..." : active ? "Update view" : "Save view"}</button>{active && <button type="button" disabled={saving} onClick={() => void save(false)} className={BUTTON}>Save as new</button>}<button type="button" disabled={saving} onClick={() => setEditingName(false)} className={BUTTON}>Cancel</button><p className="w-full text-xs text-slate-500">Saves your search, filters, sort order, and columns. Views are private to your account.</p></form>}
    {confirmDelete && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>Delete the saved view “{active?.name}”?</p><button disabled={saving} className={BUTTON} onClick={() => void remove()}>Delete saved view</button><button disabled={saving} className={BUTTON} onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
  </div>;
}
