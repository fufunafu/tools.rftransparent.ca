"use client";

import { useCallback, useEffect, useState } from "react";
import ReimbursementForm from "./ReimbursementForm";
import ReimbursementList, { type ReimbursementRow } from "./ReimbursementList";

interface Props {
  isAdmin: boolean;
}

type Scope = "mine" | "all";

export default function ReimbursementDashboard({ isAdmin }: Props) {
  const [scope, setScope] = useState<Scope>("mine");
  const [rows, setRows] = useState<ReimbursementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState<number | null>(null);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/reimbursement?scope=${s}`, { cache: "no-store" });
      const body = await res.json();
      if (res.ok) setRows(body.requests ?? []);
      else setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-sand-900">Reimbursement</h1>
        <p className="text-sand-500 text-sm mt-1">
          Submit an expense for reimbursement. Email the receipt photo to{" "}
          <a className="text-blue-600" href="mailto:finance@glass-railing.com">finance@glass-railing.com</a>{" "}
          referencing your request number.
        </p>
      </div>

      <ReimbursementForm
        onSubmitted={(id) => {
          setConfirmation(id);
          // Show the new row right away in "mine".
          if (scope !== "mine") setScope("mine");
          else void load("mine");
        }}
      />

      {confirmation !== null && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm">
          Submitted as <strong>Reimbursement #{confirmation}</strong>.{" "}
          Forward your receipt photo to{" "}
          <a className="font-medium underline" href={`mailto:finance@glass-railing.com?subject=Receipt%20for%20Reimbursement%20%23${confirmation}`}>
            finance@glass-railing.com
          </a>{" "}
          referencing #{confirmation}.
        </div>
      )}

      {isAdmin && (
        <div className="flex gap-1">
          {(["mine", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                scope === s
                  ? "bg-blue-50 text-blue-600"
                  : "text-sand-500 hover:bg-sand-50"
              }`}
            >
              {s === "mine" ? "My requests" : "All requests"}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-sand-200/60 p-8 text-center text-sm text-sand-400">
          Loading…
        </div>
      ) : (
        <ReimbursementList
          rows={rows}
          showSubmitter={scope === "all"}
          isAdmin={isAdmin && scope === "all"}
          onChanged={() => void load(scope)}
        />
      )}
    </div>
  );
}
