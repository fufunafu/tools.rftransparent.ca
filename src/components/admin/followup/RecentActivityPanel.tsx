"use client";

import { useEffect, useState } from "react";

interface StaffActivity {
  email: string;
  name: string;
  total: number;
  won: number;
  lost: number;
  ongoing: number;
  last_at: string;
}

interface ApiResponse {
  days: number | "all";
  total: number;
  staff: StaffActivity[];
}

const RANGE_OPTIONS = [
  { value: "today", label: "Today", description: "today" },
  { value: "yesterday", label: "Yesterday", description: "yesterday" },
  { value: "7", label: "7d", description: "7 days" },
  { value: "14", label: "14d", description: "14 days" },
  { value: "30", label: "30d", description: "30 days" },
  { value: "all", label: "All", description: "all time" },
] as const;
type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type ActivityDrillKind = "all" | "won" | "lost" | "ongoing";

export default function RecentActivityPanel({
  store,
  onDrillDown,
}: {
  store: string;
  onDrillDown?: (loggedBy: string, kind: ActivityDrillKind) => void;
}) {
  const [range, setRange] = useState<RangeValue>("7");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const rangeDescription =
    RANGE_OPTIONS.find((o) => o.value === range)?.description ?? "7 days";
  // "Today", "yesterday" and "all" already read as a noun phrase; the other
  // options need "in the last …" to scan correctly.
  const rangeUsesInTheLast =
    range !== "today" && range !== "yesterday" && range !== "all";

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/customer-service/follow-up?view=recent_activity&store=${store}&days=${range}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d: ApiResponse) => setData(d))
      .catch((e) => { if (e.name !== "AbortError") setData(null); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [store, range]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-sand-200/60 px-5 py-4">
        <p className="text-sm text-sand-400">Loading recent activity…</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">
            Recent Activity
          </span>
          <span className="text-sm text-sand-600">
            <span className="font-semibold text-sand-900">{data.total}</span>{" "}
            follow-up{data.total === 1 ? "" : "s"}{" "}
            {rangeUsesInTheLast ? `in the last ${rangeDescription}` : rangeDescription}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-sand-50 rounded-lg p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                range === opt.value
                  ? "bg-white text-sand-900 shadow-sm"
                  : "text-sand-500 hover:text-sand-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {data.staff.length === 0 ? (
        <div className="border-t border-sand-200/60 px-5 py-6">
          <p className="text-sm text-sand-400 text-center">
            No follow-ups logged{" "}
            {range === "all"
              ? "yet"
              : rangeUsesInTheLast
              ? `in the last ${rangeDescription}`
              : rangeDescription}
            .
          </p>
        </div>
      ) : (
        <div className="border-t border-sand-200/60 overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-sand-50">
              <tr className="border-b border-sand-200/60 bg-sand-50/50">
                <th className="text-left px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Staff</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Follow-ups</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Won</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Lost</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Open</th>
                <th className="text-right px-4 py-3 text-[11px] text-sand-400 uppercase tracking-wider font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => {
                // A drill cell is a button when both onDrillDown is wired AND
                // there's something to show (count > 0). Otherwise a plain span.
                const drill = (kind: ActivityDrillKind, count: number, className: string) =>
                  onDrillDown && count > 0 ? (
                    <button
                      onClick={() => onDrillDown(s.email, kind)}
                      className={`${className} hover:underline underline-offset-2 cursor-pointer`}
                    >
                      {count}
                    </button>
                  ) : (
                    <span className={className}>{count || "—"}</span>
                  );

                return (
                  <tr key={s.email} className="border-b border-sand-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-sand-900">{s.name}</td>
                    <td className="px-4 py-3 text-right">
                      {drill("all", s.total, "text-sand-900 font-semibold")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {drill("won", s.won, "text-green-600 font-medium")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {drill("lost", s.lost, "text-red-500")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {drill("ongoing", s.ongoing, "text-sand-600")}
                    </td>
                    <td className="px-4 py-3 text-right text-sand-500 text-xs whitespace-nowrap">
                      {relativeTime(s.last_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
