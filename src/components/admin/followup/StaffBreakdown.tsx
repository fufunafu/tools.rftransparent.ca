"use client";

import { useEffect, useMemo, useState } from "react";

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

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
}

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
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/customer-service/follow-up?view=by_staff&store=${store}&range=${range}`)
      .then((r) => r.json())
      .then((d) => setStaff(d.staff ?? []))
      .finally(() => setLoading(false));
  }, [store, range]);

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

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-sand-200/60 px-5 py-4">
        <p className="text-sm text-sand-400">Loading staff breakdown…</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return null;
  }

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

      {expanded && (
        <div className="border-t border-sand-200/60 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
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
                    {formatCurrency(s.quoted_value)}
                  </td>
                  <td className="px-4 py-3 text-right text-sand-900 font-medium">
                    {formatCurrency(s.won_value)}
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
