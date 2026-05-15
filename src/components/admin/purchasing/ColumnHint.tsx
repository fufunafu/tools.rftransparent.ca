"use client";

import { useState } from "react";

interface Props {
  children: React.ReactNode;
}

// Small (?) chip next to a column header that reveals an explanation on
// hover, focus, or click. Span-based (not button) so it can legally nest
// inside a sortable column-header <button>.
export default function ColumnHint({ children }: Props) {
  const [pinned, setPinned] = useState(false);
  return (
    <span
      className="group relative inline-flex items-center align-middle"
      onMouseLeave={() => setPinned(false)}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setPinned((v) => !v);
          }
        }}
        className="ml-1 w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-sand-300 text-[9px] text-sand-400 hover:text-accent hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer select-none"
        aria-label="Show explanation"
      >
        ?
      </span>
      <span
        className={
          "absolute top-full left-0 mt-1 w-64 bg-sand-900 text-white text-xs leading-relaxed font-normal normal-case tracking-normal rounded-lg p-2.5 z-30 shadow-lg pointer-events-none " +
          (pinned
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity")
        }
      >
        {children}
      </span>
    </span>
  );
}
