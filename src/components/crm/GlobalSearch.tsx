"use client";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import useSWR from "swr";
import type { CrmSearchResults } from "@/lib/crm/search";
import type { CrmRecord } from "@/lib/crm/types";
import RecordAvatar from "./RecordAvatar";
import { ErrorMessage, cleanSummary, fetchJson, recordTitle, useDateLabel } from "./shared";

const SECTIONS = [["contacts", "Contacts"], ["companies", "Companies"], ["tasks", "Open tasks"]] as const;

/** Search contacts, companies and open tasks from anywhere in the CRM. The "/"
 * key opens it (Ctrl+K and Cmd+K already open the site-wide page search). */
export default function GlobalSearch({ onSelect }: { onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey && !document.querySelector("dialog[open]")) { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex min-h-10 w-full max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-500 hover:border-slate-300">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span className="flex-1">Search CRM</span><kbd className="hidden rounded border border-slate-200 px-1.5 text-[11px] text-slate-400 sm:inline">/</kbd>
    </button>
    {open && <SearchDialog onClose={() => setOpen(false)} onSelect={id => { setOpen(false); onSelect(id); }} />}
  </>;
}

function SearchDialog({ onClose, onSelect }: { onClose: () => void; onSelect: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const dateLabel = useDateLabel();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setActive(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const { data, error, isLoading } = useSWR<CrmSearchResults>(query.length >= 2 ? `/api/crm/search?q=${encodeURIComponent(query)}` : null, fetchJson, { keepPreviousData: true });
  const flat: CrmRecord[] = data ? SECTIONS.flatMap(([key]) => data[key]) : [];
  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(index + 1, flat.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
    if (event.key === "Enter" && flat[active]) { event.preventDefault(); onSelect(flat[active].id); }
  }
  let index = -1;
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }} aria-label="Search CRM" className="mt-[10vh] w-[min(94vw,40rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40">
    <div className="border-b border-slate-200 p-3"><input autoFocus type="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={onKeyDown} role="combobox" aria-expanded={flat.length > 0} aria-controls="crm-search-results" aria-activedescendant={flat[active] ? `crm-search-${flat[active].id}` : undefined}
      placeholder="Name, email, phone, company or task" className="w-full rounded-lg px-3 py-2.5 text-base text-slate-900 outline-none focus:ring-2 focus:ring-orange-100" /></div>
    <div id="crm-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
      <ErrorMessage error={error} />
      {query.length < 2 && <p className="p-4 text-sm text-slate-500">Type at least 2 characters. Use the arrow keys and Enter to open a result.</p>}
      {query.length >= 2 && isLoading && !data && <p role="status" className="p-4 text-sm text-slate-500">Searching...</p>}
      {data && !flat.length && <p className="p-4 text-sm text-slate-500">No contacts, companies or open tasks match &ldquo;{query}&rdquo;.</p>}
      {data && SECTIONS.map(([key, label]) => data[key].length > 0 && <section key={key} className="mb-2"><h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</h3>
        {data[key].map(record => { index += 1; const mine = index; return <button key={record.id} id={`crm-search-${record.id}`} role="option" aria-selected={mine === active} onMouseEnter={() => setActive(mine)} onClick={() => onSelect(record.id)}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${mine === active ? "bg-orange-50" : ""}`}>
          {key === "tasks" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">✓</span> : <RecordAvatar record={record} />}
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-cyan-800">{recordTitle(record)}</span><span className="block truncate text-xs text-slate-500">{key === "tasks" ? `Due ${dateLabel(record.effective_due_at)}` : record.view_fields?.email || record.view_fields?.domain || cleanSummary(record.summary)}</span></span>
        </button>; })}</section>)}
    </div>
  </dialog>;
}
