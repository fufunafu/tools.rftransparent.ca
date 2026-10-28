"use client";

import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { DIRECTORY_FIELDS, DIRECTORY_LABELS, DIRECTORY_SORTS, directoryFilterCount, type DirectoryField, type DirectoryFilters as Filters, type DirectoryOptions, type DirectorySort } from "@/lib/crm/directory";
import { BUTTON, fetchJson, ownerLabel, stageLabel } from "./shared";

export default function DirectoryFilters({ type, email, archived, filters, source, sort, onChange, onSource, onSort, onClear }: {
  type: "contacts" | "companies"; email: string; archived: boolean; filters: Filters; source: string; sort: DirectorySort;
  onChange: (filters: Filters) => void; onSource: (source: string) => void; onSort: (sort: DirectorySort) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState<DirectoryField | null>(null);
  const [requested, setRequested] = useState(false);
  const [search, setSearch] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const buttons = useRef<Partial<Record<DirectoryField, HTMLButtonElement | null>>>({});
  const id = useId();
  const filterCount = directoryFilterCount(filters);
  const { data, error, isLoading, mutate } = useSWR<DirectoryOptions>(requested || filterCount > 0 ? `/api/crm?filtersOnly=true&type=${type}&archived=${archived}` : null, fetchJson, { revalidateOnFocus: false, dedupingInterval: 60000 });
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function close() { if (open) buttons.current[open]?.focus(); setOpen(null); }
  function label(field: DirectoryField, value: string) {
    if (!value) return field === "owner" ? "Unassigned" : "Not set";
    const saved = data?.[field]?.find(option => option.value === value)?.label || value;
    if (field === "owner") return `${ownerLabel(saved)}${value === email.toLowerCase() ? " (me)" : ""}`;
    return field === "stage" ? stageLabel(saved) : saved;
  }
  function toggle(field: DirectoryField, value: string) {
    onChange({ ...filters, [field]: filters[field].includes(value) ? filters[field].filter(item => item !== value) : [...filters[field], value] });
  }
  const active = filterCount + Number(Boolean(source));
  const matching = open ? (data?.[open] ?? []).filter(option => `${label(open, option.value)} ${option.value}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  return <div className="border-b border-slate-200 px-5 py-3" aria-label={`${type === "contacts" ? "Contact" : "Company"} filters`}>
    <div ref={container} className="relative" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <div className="flex flex-wrap items-center gap-2">
        {DIRECTORY_FIELDS.map(field => <button key={field} ref={element => { buttons.current[field] = element; }} type="button" aria-expanded={open === field} aria-controls={open === field ? `${id}-options` : undefined} onClick={() => { setRequested(true); setSearch(""); setOpen(open === field ? null : field); }} className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm ${filters[field].length ? "border-orange-300 bg-orange-50 font-semibold text-orange-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
          {DIRECTORY_LABELS[field]}{filters[field].length > 0 && <span className="rounded bg-orange-100 px-1.5 text-xs">{filters[field].length}</span>}<span aria-hidden="true" className="text-xs text-slate-400">▾</span>
        </button>)}
        <label className="sr-only" htmlFor={`${id}-source`}>Record source</label><select id={`${id}-source`} value={source} onChange={event => onSource(event.target.value)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="">All sources</option><option value="hubspot">HubSpot</option><option value="tools">Tools</option></select>
        <div className="ml-auto"><label className="sr-only" htmlFor={`${id}-sort`}>Sort records</label><select id={`${id}-sort`} value={sort} onChange={event => onSort(event.target.value as DirectorySort)} className="min-h-10 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">{Object.entries(DIRECTORY_SORTS).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
      </div>
      {open && <div id={`${id}-options`} role="dialog" aria-label={`Filter by ${DIRECTORY_LABELS[open].toLowerCase()}`} className="absolute left-0 top-full z-30 mt-2 w-80 max-w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">{DIRECTORY_LABELS[open]}</h3><button type="button" aria-label="Close filter" className="h-8 w-8 rounded text-slate-500 hover:bg-slate-100" onClick={close}>×</button></div>
        <input ref={searchInput} aria-label={`Search ${DIRECTORY_LABELS[open].toLowerCase()} options`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${DIRECTORY_LABELS[open].toLowerCase()}`} className="mb-2 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-orange-500" />
        <p className="mb-2 px-2 text-xs text-slate-400">Counts across all {archived ? "archived" : "active"} {type}</p>
        {isLoading && <p role="status" className="p-3 text-sm text-slate-500">Loading options...</p>}
        {error && <div role="alert" className="p-2 text-sm text-red-700">Could not load filters. <button type="button" onClick={() => void mutate()} className="underline">Retry</button></div>}
        {!error && data && <div className="max-h-64 space-y-1 overflow-y-auto">{matching.map(option => <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-700 hover:bg-orange-50"><input type="checkbox" checked={filters[open].includes(option.value)} disabled={!filters[open].includes(option.value) && filters[open].length >= 20} onChange={() => toggle(open, option.value)} className="h-4 w-4 accent-orange-700" /><span className={`min-w-0 flex-1 break-words ${open === "owner" ? "capitalize" : ""}`}>{label(open, option.value)}</span><span className="text-xs tabular-nums text-slate-400">{option.count.toLocaleString()}</span></label>)}{!matching.length && <p className="p-3 text-sm text-slate-500">No matching options</p>}</div>}
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2"><button type="button" className="min-h-9 text-xs font-semibold text-slate-600 underline disabled:opacity-40" disabled={!filters[open].length} onClick={() => onChange({ ...filters, [open]: [] })}>Clear {DIRECTORY_LABELS[open].toLowerCase()}</button><button type="button" className={BUTTON} onClick={close}>Done</button></div>
      </div>}
    </div>
    {active > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">{DIRECTORY_FIELDS.flatMap(field => filters[field].map(value => <button key={`${field}:${value}`} type="button" aria-label={`Remove ${DIRECTORY_LABELS[field].toLowerCase()} filter: ${label(field, value)}`} onClick={() => toggle(field, value)} className="flex min-h-8 max-w-full items-center gap-2 rounded-md bg-orange-50 px-2.5 py-1 text-xs text-orange-900"><span className="truncate">{DIRECTORY_LABELS[field]}: <span className={field === "owner" ? "capitalize" : ""}>{label(field, value)}</span></span><span aria-hidden="true">×</span></button>))}{source && <button type="button" aria-label="Remove source filter" onClick={() => onSource("")} className="min-h-8 rounded-md bg-orange-50 px-2.5 text-xs text-orange-900">Source: {source === "hubspot" ? "HubSpot" : "Tools"} <span aria-hidden="true">×</span></button>}<button type="button" onClick={onClear} className="min-h-8 px-2 text-xs font-semibold text-slate-600 underline">Clear all filters</button></div>}
  </div>;
}
