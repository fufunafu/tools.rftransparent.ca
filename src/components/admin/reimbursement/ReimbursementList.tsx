"use client";

import { useState } from "react";

export interface ReimbursementRow {
  id: number;
  submitted_by_email: string;
  expense_date: string;
  amount: number;
  vendor: string;
  category: string;
  description: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  submitted_at: string;
}

interface Props {
  rows: ReimbursementRow[];
  showSubmitter: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}

const STATUS_STYLES: Record<ReimbursementRow["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ReimbursementList({ rows, showSubmitter, isAdmin, onChanged }: Props) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function setStatus(id: number, status: "approved" | "rejected", reason?: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/accounting/reimbursement/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejection_reason: reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Update failed");
        return;
      }
      onChanged();
    } finally {
      setBusyId(null);
      setRejectingId(null);
      setRejectReason("");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-sand-200/60 p-8 text-center text-sm text-sand-400">
        No requests yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-white">
            <tr className="border-b border-sand-200/60 text-[11px] text-sand-400 uppercase tracking-wider font-medium">
              <th className="text-left px-4 py-3">#</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Vendor</th>
              <th className="text-left px-4 py-3">Category</th>
              {showSubmitter && <th className="text-left px-4 py-3">Submitted by</th>}
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Submitted</th>
              {isAdmin && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-sand-100 align-top">
                <td className="px-4 py-3 font-medium text-sand-900">#{r.id}</td>
                <td className="px-4 py-3 text-sand-700 whitespace-nowrap">{formatDate(r.expense_date)}</td>
                <td className="px-4 py-3 text-sand-700">
                  <div>{r.vendor}</div>
                  {r.description && (
                    <div className="text-xs text-sand-500 mt-0.5 whitespace-pre-wrap">{r.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sand-700">{r.category}</td>
                {showSubmitter && <td className="px-4 py-3 text-sand-600">{r.submitted_by_email}</td>}
                <td className="px-4 py-3 text-right font-medium text-sand-900 tabular-nums">
                  {formatAmount(Number(r.amount))}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[r.status]}`}>
                    {r.status}
                  </span>
                  {r.status === "rejected" && r.rejection_reason && (
                    <div className="text-xs text-sand-500 mt-1 max-w-xs whitespace-pre-wrap">
                      {r.rejection_reason}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sand-500 whitespace-nowrap">{formatDate(r.submitted_at)}</td>
                {isAdmin && (
                  <td className="px-4 py-3">
                    {r.status === "pending" ? (
                      <div className="flex gap-2 whitespace-nowrap">
                        <button
                          disabled={busyId === r.id}
                          onClick={() => setStatus(r.id, "approved")}
                          className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-md hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === r.id}
                          onClick={() => { setRejectingId(r.id); setRejectReason(""); }}
                          className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 rounded-md hover:bg-rose-100 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-sand-400">
                        {r.reviewed_by_email ? `by ${r.reviewed_by_email}` : ""}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectingId !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setRejectingId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-sand-900">
              Reject reimbursement #{rejectingId}
            </h3>
            <textarea
              rows={3}
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (sent to the submitter)"
              className="w-full px-3 py-2 text-sm border border-sand-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectingId(null)}
                className="px-3 py-1.5 text-sm text-sand-600"
              >
                Cancel
              </button>
              <button
                disabled={!rejectReason.trim() || busyId === rejectingId}
                onClick={() => setStatus(rejectingId, "rejected", rejectReason.trim())}
                className="px-3 py-1.5 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
