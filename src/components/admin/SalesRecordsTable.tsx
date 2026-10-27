"use client";

import { useState } from "react";
import { formatCAD } from "@/lib/format";
import type { SalesRecordDetail } from "@/lib/sales-record-details";

const PAGE_SIZE = 10;

export function SalesRecordsTable({ records, total, kind, dateLabel = "Created", amountLabel = "Amount" }: {
  records: SalesRecordDetail[];
  total: number;
  kind: "orders" | "quotes";
  dateLabel?: string;
  amountLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const filtered = sorted.filter((record) => [record.name, record.customerName ?? ""].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const date = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{records.length} {kind} · <strong className="text-slate-900">{formatCAD(total)}</strong> total</p>
        <input type="search" aria-label={`Search ${kind} by number or customer`} placeholder={`Search ${kind} by number or customer`} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="w-full sm:w-80 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>
            <th className="px-3 py-3" scope="col">{kind === "orders" ? "Order" : "Quote"}</th>
            <th className="px-3 py-3" scope="col">Customer</th>
            <th className="px-3 py-3" scope="col">{dateLabel}</th>
            <th className="px-3 py-3" scope="col">Status</th>
            <th className="px-3 py-3 text-right" scope="col">{amountLabel}</th>
          </tr></thead>
          <tbody>{visible.map((record) => <tr key={record.id} className="border-t border-slate-100">
            <th scope="row" className="px-3 py-3 font-medium"><a href={record.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline" aria-label={`Open ${record.name} in Shopify`}>{record.name} ↗</a></th>
            <td className="min-w-[150px] max-w-[260px] px-3 py-3 text-slate-900 break-words">{record.customerName || <span className="text-slate-400">Name unavailable</span>}</td>
            <td className="px-3 py-3 whitespace-nowrap text-slate-600">{date(record.date)}</td>
            <td className="px-3 py-3 text-slate-600">{record.status}</td>
            <td className={`px-3 py-3 text-right tabular-nums font-medium ${record.amount < 0 ? "text-red-700" : "text-slate-900"}`}>{formatCAD(record.amount)}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className="p-6 text-center text-sm text-slate-500">{records.length ? `No ${kind} match that number or customer.` : `No ${kind} in this period.`}</p>}
      </div>
      {pages > 1 && <div className="flex items-center justify-between text-xs text-slate-600">
        <span>Page {currentPage + 1} of {pages} · {filtered.length} {kind}</span>
        <div className="flex gap-2">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-md border px-3 py-2 disabled:opacity-40">Previous</button>
          <button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded-md border px-3 py-2 disabled:opacity-40">Next</button>
        </div>
      </div>}
      {search && <p className="text-xs text-slate-500">Matching {kind}: {formatCAD(filtered.reduce((sum, record) => sum + record.amount, 0))}. The total above includes the full period.</p>}
    </div>
  );
}
