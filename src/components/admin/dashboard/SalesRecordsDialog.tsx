"use client";

import { useEffect, useRef, useState } from "react";
import { SalesRecordsTable } from "@/components/admin/SalesRecordsTable";
import { getSalesPeriod, type SalesPeriod } from "@/lib/sales-periods";
import type { SalesRecordList } from "@/lib/sales-record-details";

export interface SalesRecordsSelection { repId: string; repName: string; period: SalesPeriod; kind: "orders" | "quotes" }

export function SalesRecordsDialog({ selection, onClose }: { selection: SalesRecordsSelection; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<SalesRecordList | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ repId: selection.repId, period: selection.period, kind: selection.kind });
    fetch(`/api/dashboards/sales/records?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load records.");
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [selection.repId, selection.period, selection.kind, attempt]);
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="sales-records-title" className="m-auto w-[calc(100%-2rem)] max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4">
      <div><h2 id="sales-records-title" className="text-lg font-semibold text-slate-900">{selection.repName} · {selection.kind}</h2>
        <p className="mt-1 text-sm text-slate-500">{getSalesPeriod(selection.period).label}</p></div>
      <button type="button" onClick={onClose} aria-label="Close records" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button>
    </div>
    <div className="space-y-4 p-5">
      <p className="text-xs text-slate-500">{selection.kind === "orders" ? "Payments and refunds in this period, excluding tax and shipping. An older order can appear when a payment or refund falls in this period." : "Quotes created in this period, excluding unsent drafts. Uses the same ownership rules as the sales table."}</p>
      {error ? <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button onClick={() => { setError(""); setAttempt(attempt + 1); }} className="mt-2 underline">Try again</button></div> : !result ? <p role="status" className="py-8 text-center text-sm text-slate-500">Loading {selection.kind}…</p> : <>
        {result.warnings.length > 0 && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{result.warnings.join(" ")}</p>}
        <SalesRecordsTable records={result.records} total={result.total} kind={selection.kind} dateLabel={selection.kind === "orders" ? "Payment / refund" : "Created"} amountLabel={selection.kind === "orders" ? "Net in period" : "Quoted"} />
      </>}
    </div>
  </dialog>;
}
