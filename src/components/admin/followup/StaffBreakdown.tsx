"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCADWhole } from "@/lib/format";

interface StaffAgg {
  staff: string;
  total: number;
  won: number;
  lost: number;
  active: number;
  quoted_value: number;
  won_value: number;
  conversion_rate: number;
}

type SortKey =
  | "staff"
  | "total"
  | "won"
  | "lost"
  | "active"
  | "conversion_rate"
  | "quoted_value"
  | "won_value";
type SortDir = "asc" | "desc";

// Time-window toggle — mirrors the Recent Activity panel. Filters by when the
// quote was sent (shopify_created_at). "All" = every quote in the dashboard's
// current range.
const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
  { value: "all", label: "All" },
] as const;
type DaysValue = (typeof RANGE_OPTIONS)[number]["value"];

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg viewBox="0 0 12 12" className={`w-3 h-3 inline-block ml-1 ${active ? "text-blue-500" : "text-sand-300"}`}>
      <path d="M6 1L9 5H3L6 1Z" fill={active && dir === "asc" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1" />
      <path d="M6 11L3 7H9L6 11Z" fill={active && dir === "desc" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export default function StaffBreakdown({
  store,
  range = "1y",
  onStaffClick,
}: {
  store: string;
  range?: "1y" | "all";
  onStaffClick?: (staff: string) => void;
}) {
  const [staff, setStaff] = useState<StaffAgg[]>([]);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Local time window. "all" defers to the dashboard's coarse range prop (1y/all);
  // any other value sends an explicit `days=` that the API windows server-side.
  const [days, setDays] = useState<DaysValue>("all");
  const queryKey = `${store}:${range}:${days}`;
  const loading = resolvedKey !== queryKey;

  useEffect(() => {
    const ctrl = new AbortController();
    const url =
      days === "all"
        ? `/api/customer-service/follow-up?view=by_staff&store=${store}&range=${range}`
        : `/api/customer-service/follow-up?view=by_staff&store=${store}&days=${days}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setStaff(d.staff ?? []))
      .catch((e) => { if (e.name !== "AbortError") setStaff([]); })
      .finally(() => {
        if (!ctrl.signal.aborted) setResolvedKey(queryKey);
      });
    return () => ctrl.abort();
  }, [store, range, days, queryKey]);

  const hasDeleted = staff.some((s) => s.staff.endsWith(" (deleted)"));

  const sorted = useMemo(() => {
    const list = staff.filter((s) => showDeleted || !s.staff.endsWith(" (deleted)"));
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [staff, sortKey, sortDir, showDeleted]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "staff" ? "asc" : "desc");
    }
  };

  // The toggle/header always render so the user can switch windows even when a
  // window has zero quotes — an early `return null` would trap them on empty.
  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "staff", label: "Staff", align: "left" },
    { key: "total", label: "Quotes", align: "right" },
    { key: "won", label: "Won", align: "right" },
    { key: "lost", label: "Lost", align: "right" },
    { key: "active", label: "Active", align: "right" },
    { key: "conversion_rate", label: "Conv. Rate", align: "right" },
    { key: "quoted_value", label: "Quoted $", align: "right" },
    { key: "won_value", label: "Won $", align: "right" },
  ];

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      <div className="w-full flex items-center justify-between px-5 py-4 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">
            Quotes by Staff
          </span>
          {loading ? (
            <span className="text-xs text-sand-400">Loading…</span>
          ) : sorted.length === 0 ? (
            <span className="text-xs text-sand-400">No quotes in this window</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sorted.slice(0, 6).map((s) => (
                <button
                  key={s.staff}
                  onClick={() => onStaffClick?.(s.staff)}
                  disabled={!onStaffClick}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-sand-100 text-sand-700 hover:bg-blue-100 hover:text-blue-700 transition-colors disabled:cursor-default disabled:hover:bg-sand-100 disabled:hover:text-sand-700"
                  title={onStaffClick ? `Show leads by ${s.staff}` : undefined}
                >
                  {s.staff}
                  <span className="font-semibold">{s.total}</span>
                </button>
              ))}
              {sorted.length > 6 && (
                <span className="text-xs text-sand-400 self-center">
                  +{sorted.length - 6} more
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-sand-50 rounded-lg p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  days === opt.value
                    ? "bg-white text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        {hasDeleted && (
          <button
            onClick={() => setShowDeleted(!showDeleted)}
            className="shrink-0 text-xs text-sand-400 hover:text-sand-600 transition-colors"
          >
            {showDeleted ? "Hide deleted" : "Show deleted"}
          </button>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 p-1 text-sand-400 hover:text-sand-600"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        </div>
      </div>

      {expanded && sorted.length > 0 && (
        <div className="border-t border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-sand-50">
              <tr className="border-b border-sand-200/60 bg-sand-50/50">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`${col.align === "right" ? "text-right" : "text-left"} px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium cursor-pointer hover:text-sand-600 select-none whitespace-nowrap`}
                  >
                    {col.label}
                    <SortIcon active={sortKey === col.key} dir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={s.staff}
                  onClick={() => onStaffClick?.(s.staff)}
                  className={`border-b border-sand-100 hover:bg-sand-50/40 ${onStaffClick ? "cursor-pointer" : ""}`}
                >
                  <td className="px-4 py-3 font-medium text-sand-900">{s.staff}</td>
                  <td className="px-4 py-3 text-right text-sand-700">{s.total}</td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">{s.won}</td>
                  <td className="px-4 py-3 text-right text-red-500">{s.lost}</td>
                  <td className="px-4 py-3 text-right text-sand-600">{s.active}</td>
                  <td className="px-4 py-3 text-right text-sand-700">
                    {s.total > 0 ? `${s.conversion_rate}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-sand-600">
                    {formatCADWhole(s.quoted_value)}
                  </td>
                  <td className="px-4 py-3 text-right text-sand-900 font-medium">
                    {formatCADWhole(s.won_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
