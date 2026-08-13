"use client";

import { useState, useRef, useCallback } from "react";

// The provenance-popover pane, same behavior as the owner dashboard: one
// delegated listener, popovers driven by data-label/data-calc/data-src on any
// descendant. Wrap a role dashboard's content in this to get the hover
// explanations for free.

interface Popover {
  label: string;
  calc: string;
  src: string;
  x: number;
  y: number;
}

const POPOVER_WIDTH = 264;

export function DashboardPane({ children }: { children: React.ReactNode }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<Popover | null>(null);

  const onMouseOver = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-calc]");
    const pane = paneRef.current;
    if (!el || !pane) {
      setPopover(null);
      return;
    }
    const paneBox = pane.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const x = Math.min(box.left - paneBox.left, paneBox.width - POPOVER_WIDTH - 8);
    setPopover({
      label: el.dataset.label ?? "",
      calc: el.dataset.calc ?? "",
      src: el.dataset.src ?? "",
      x: Math.max(0, x),
      y: box.bottom - paneBox.top + 6,
    });
  }, []);

  return (
    <div
      ref={paneRef}
      className="relative max-w-[1184px] mx-auto space-y-3"
      onMouseOver={onMouseOver}
      onMouseLeave={() => setPopover(null)}
    >
      {children}
      {popover && popover.calc && (
        <div
          className="absolute z-40 pointer-events-none bg-white border border-slate-200 rounded-lg shadow-soft p-2.5"
          style={{ width: POPOVER_WIDTH, left: popover.x, top: popover.y }}
        >
          <p className="text-[9px] font-semibold uppercase tracking-wider text-blue-600">{popover.label}</p>
          <p className="text-[11px] text-slate-600 mt-1 leading-snug">{popover.calc}</p>
          {popover.src && (
            <p className="text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100">{popover.src}</p>
          )}
        </div>
      )}
    </div>
  );
}
