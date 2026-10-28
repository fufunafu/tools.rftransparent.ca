"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string; count?: number; disabled?: boolean };

export function filterSelections(value: string, allValues: string[]): string[] {
  return value === "all" ? allValues : value.split(",").filter(Boolean);
}

export default function LeadFilterDropdown({ label, fieldLabel, allLabel, options, value, onChange, allValues = options.filter(option => !option.disabled).map(option => option.value) }: {
  label: string;
  fieldLabel?: string;
  allLabel: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  allValues?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = filterSelections(value, allValues);
  const allChecked = allValues.every(item => selected.includes(item));
  const labels = options.filter(option => selected.includes(option.value)).map(option => option.label);
  const summary = allChecked && selected.length === allValues.length ? allLabel : labels.length ? labels.join(", ") : "None selected";
  const commitSelection = (items: string[]) => onChange(items.length === allValues.length && allValues.every(item => items.includes(item)) ? "all" : items.join(","));
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div ref={ref} className="relative" onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
  }} onBlur={event => {
    // Clicking label text can briefly blur the trigger without a new focus
    // target. Keep the label mounted so its click reaches the checkbox.
    // Outside pointerdown and actual keyboard focus leaving still dismiss.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => { setAlignRight((trigger.current?.getBoundingClientRect().left ?? 0) + 256 > window.innerWidth - 16); setOpen(!open); }} title={summary} className={fieldLabel ? "flex h-9 items-center gap-2 rounded-md px-2 text-sm font-semibold text-sand-800 hover:bg-sand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" : "flex h-10 max-w-[260px] items-center gap-2 rounded-md border border-sand-200 bg-white px-3 text-xs text-sand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"}>
      <span className="truncate">{fieldLabel ?? summary}</span>{fieldLabel && !(allChecked && selected.length === allValues.length) && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" />}<span aria-hidden="true" className="ml-auto text-sand-400">▾</span>
    </button>
    {open && <div id={id} role="group" aria-label={label} className={`absolute ${alignRight ? "right-0" : "left-0"} top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-sand-200 bg-white p-2 shadow-lg`}>
      <div className="flex items-center justify-between border-b border-sand-100 pb-2">
        <label className="flex cursor-pointer items-center gap-2 p-1 text-xs font-medium"><input ref={element => { if (element) element.indeterminate = !allChecked && allValues.some(item => selected.includes(item)); }} type="checkbox" checked={allChecked} onChange={() => commitSelection(allChecked ? selected.filter(item => !allValues.includes(item)) : [...new Set([...selected, ...allValues])])} />{allLabel}</label>
        <button type="button" onClick={() => onChange("")} className="p-1 text-xs text-blue-700">Clear</button>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">{options.map(option => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs text-sand-700 hover:bg-sand-50 has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
        <input type="checkbox" value={option.value} checked={selected.includes(option.value)} disabled={option.disabled} onChange={() => commitSelection(selected.includes(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value])} />
        <span>{option.label}</span>{option.count != null && <span className="ml-auto tabular-nums text-sand-400">{option.count}</span>}
      </label>)}</div>
      <p className="border-t border-sand-100 px-2 pt-2 text-[10px] text-sand-400">Select any combination</p>
    </div>}
  </div>;
}
