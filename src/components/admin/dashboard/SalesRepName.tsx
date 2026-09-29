"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Performer } from "@/lib/ops-dashboard";
import { PerformerLink } from "./PerformersSection";

export function SalesRepName({ person, rank }: { person: Performer; rank: number }) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function show() {
    cancelClose();
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(360, window.innerWidth - 24);
    const below = window.innerHeight - box.bottom - 20;
    const above = box.top - 20;
    const placeBelow = below >= Math.min(320, above);
    const maxHeight = Math.max(40, Math.min(320, placeBelow ? below : above));
    setPosition({
      left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
      top: placeBelow ? box.bottom + 8 : Math.max(12, box.top - maxHeight - 8),
      maxHeight,
    });
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setPosition(null), 150);
  }

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const open = position !== null;
  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", close);
    const onScroll = (event: Event) => {
      if (!tooltip.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={anchor} className="flex items-center gap-1" onMouseEnter={show} onMouseLeave={scheduleClose}
      onFocus={show} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }}>
      <PerformerLink person={person} aria-describedby={open ? id : undefined}
        className="flex items-center gap-2.5 text-[13px] font-semibold text-slate-900 hover:text-blue-700">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-medium text-slate-500">{rank}</span>
        <span>{person.name}</span>
      </PerformerLink>
      <button type="button" aria-label={`How ${person.name}'s totals are calculated`} aria-describedby={open ? id : undefined}
        onClick={show} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" />
        </svg>
      </button>
      {position && createPortal(
        <div ref={tooltip} id={id} role="tooltip" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
          className="fixed z-[60] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-xs font-normal leading-relaxed text-slate-600 shadow-xl"
          style={position}>
          <p className="font-semibold text-slate-900">{person.name}: how totals are calculated</p>
          <p className="mt-2">{person.attributionExplanation ?? "Uses this rep's configured sales attribution rules."}</p>
          <p className="mt-2"><strong>Net sales:</strong> successful payments minus refunds, by transaction date within each column&apos;s period. Tax and shipping are removed proportionally from each payment or refund.</p>
          <p className="mt-2"><strong>Quoted:</strong> sent and completed quotes created in the period, excluding tax and shipping. Unsent drafts are excluded. Uses the same rep attribution rules.</p>
          <p className="mt-2 text-[11px] text-slate-500">Periods include today and use Toronto time. Conversion is completed quotes divided by sent and completed quotes. Ranking uses the last 30 days.</p>
        </div>, document.body,
      )}
    </div>
  );
}
