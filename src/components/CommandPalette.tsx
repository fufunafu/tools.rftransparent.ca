"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface NavTarget {
  href: string;
  label: string;
  // Parent section this page sits under, e.g. "Logistics". Absent for
  // top-level pages that have no children of their own.
  section?: string;
  // Absolute URL to a separate site — opened in a new tab.
  external?: boolean;
}

// Letters of `q` appear in `text` in order, gaps allowed: "custinv" finds
// "Customs Invoice".
function isSubsequence(q: string, text: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

// Match tiers — lower sorts higher. -1 means no match at all.
function rank(target: NavTarget, q: string): number {
  const label = target.label.toLowerCase();
  const section = target.section?.toLowerCase() ?? "";
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  // Typing a section name ("logistics") lists every page inside it.
  if (section.includes(q)) return 2;
  if (isSubsequence(q, label)) return 3;
  return -1;
}

const ExternalIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-slate-300">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

/**
 * Jump-to-page search. Mounted only while open, so each launch starts with a
 * fresh query — the parent owns the open state and the ⌘K shortcut.
 */
export default function CommandPalette({
  targets,
  onClose,
}: {
  targets: NavTarget[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets
      .map((target) => ({ target, tier: rank(target, q) }))
      .filter((r) => r.tier >= 0)
      .sort((a, b) => a.tier - b.tier)
      .map((r) => r.target);
  }, [targets, query]);

  // Results shrink as you type, so the stored index can outrun the list.
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  // Keep the highlighted row visible during arrow-key runs.
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Lock background scroll while the overlay is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const select = (target: NavTarget) => {
    onClose();
    if (target.external) {
      window.open(target.href, "_blank", "noopener,noreferrer");
    } else {
      router.push(target.href);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(results.length ? (activeIndex + 1) % results.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(results.length ? (activeIndex - 1 + results.length) % results.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[activeIndex];
      if (target) select(target);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-slate-400 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages…"
            aria-label="Search pages"
            aria-controls="command-palette-results"
            className="flex-1 py-3.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none bg-transparent"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-400 text-center">No pages match “{query}”.</p>
        ) : (
          <div id="command-palette-results" ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1.5">
            {results.map((target, i) => (
              <button
                key={`${target.section ?? ""}${target.href}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => select(target)}
                onMouseMove={() => setActive(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === activeIndex ? "bg-blue-50 text-blue-600" : "text-slate-600"
                }`}
              >
                <span className="flex-1 font-medium">{target.label}</span>
                {target.section ? (
                  <span className="text-xs text-slate-400">{target.section}</span>
                ) : null}
                {target.external ? ExternalIcon : null}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
