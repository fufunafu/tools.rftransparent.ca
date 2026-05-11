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
  days: number;
  total: number;
  staff: StaffActivity[];
}

const RANGE_OPTIONS = [3, 7, 14, 30] as const;
type Range = (typeof RANGE_OPTIONS)[number];

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

export default function RecentActivityPanel({ store }: { store: string }) {
  const [days, setDays] = useState<Range>(7);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/customer-service/follow-up?view=recent_activity&store=${store}&days=${days}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d: ApiResponse) => setData(d))
      .catch((e) => { if (e.name !== "AbortError") setData(null); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [store, days]);

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
            follow-up{data.total === 1 ? "" : "s"} in the last {days} days
          </span>
        </div>
        <div className="flex items-center gap-1 bg-sand-50 rounded-lg p-0.5">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                days === d
                  ? "bg-white text-sand-900 shadow-sm"
                  : "text-sand-500 hover:text-sand-700"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data.staff.length === 0 ? (
        <div className="border-t border-sand-200/60 px-5 py-6">
          <p className="text-sm text-sand-400 text-center">
            No follow-ups logged in the last {days} days.
          </p>
        </div>
      ) : (
        <div className="border-t border-sand-200/60 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
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
              {data.staff.map((s) => (
                <tr key={s.email} className="border-b border-sand-100 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-sand-900">{s.name}</td>
                  <td className="px-4 py-3 text-right text-sand-900 font-semibold">{s.total}</td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">{s.won || "—"}</td>
                  <td className="px-4 py-3 text-right text-red-500">{s.lost || "—"}</td>
                  <td className="px-4 py-3 text-right text-sand-600">{s.ongoing || "—"}</td>
                  <td className="px-4 py-3 text-right text-sand-500 text-xs whitespace-nowrap">
                    {relativeTime(s.last_at)}
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
