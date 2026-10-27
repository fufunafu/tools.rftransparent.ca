"use client";
import Link from "next/link";
import useSWR from "swr";
import type { SalesSnapshot, SalesState } from "@/lib/purchasing/sales-types";
export default function SalesSyncStatus() {
  const { data, error } = useSWR<{ snapshot: SalesSnapshot | null; states: SalesState[]; checked_at: string }>("/api/purchasing/sales?status=1", { refreshInterval: 60_000 });
  const snapshot = data?.snapshot;
  const stale = snapshot ? new Date(data?.checked_at ?? snapshot.refreshed_at).getTime() - new Date(snapshot.refreshed_at).getTime() > 30 * 60_000 : false;
  const failed = data?.states.some(s => s.last_error);
  return <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${error || stale || failed ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sand-200 bg-white text-sand-600"}`}>
    <span>{error ? "Sales refresh unavailable. Previous purchasing values are retained." : snapshot ? `RF + GRS updated ${new Date(snapshot.refreshed_at).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET${stale || failed ? ". Refresh delayed; showing the last complete update." : " · Every 5 min."}` : "RF + GRS sales history is being prepared. Existing baselines are retained."}</span>
    <Link href="/warehouse/purchasing/sales" className="font-medium text-accent hover:underline">Sales history{snapshot && snapshot.review_sources > 0 ? ` · ${snapshot.review_sources} matches to review` : ""}</Link>
  </div>;
}
