"use client";

import { useEffect } from "react";

export interface BulkChange {
  sku: string;
  name: string;
  current: number;
  proposed: number;
}

interface Props {
  changes: BulkChange[];
  unchanged: number;
  skipped: Array<{ sku: string; reason: string }>;
  applying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function BulkUploadPreviewDialog({
  changes, unchanged, skipped, applying, onCancel, onConfirm,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-sand-200/60">
          <h2 className="text-lg font-semibold text-sand-900">Review changes</h2>
          <p className="text-sm text-sand-600 mt-1">
            <span className="font-medium text-sand-900">{changes.length}</span> row{changes.length === 1 ? "" : "s"} will change
            {unchanged > 0 && `, ${unchanged} unchanged`}
            {skipped.length > 0 && `, ${skipped.length} skipped`}. Nothing has been written yet.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {changes.length > 0 && (
            <div className="bg-white rounded-xl border border-sand-200/60 overflow-hidden">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-sand-50 text-sand-500 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Name</th>
                    <th className="text-right px-3 py-2 font-medium">Current</th>
                    <th className="text-right px-3 py-2 font-medium">Proposed</th>
                    <th className="text-right px-3 py-2 font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {changes.map((c) => {
                    const delta = c.proposed - c.current;
                    return (
                      <tr key={c.sku}>
                        <td className="px-3 py-1.5 font-mono text-xs">{c.sku}</td>
                        <td className="px-3 py-1.5 text-sand-700">{c.name}</td>
                        <td className="px-3 py-1.5 text-right text-sand-500">{c.current.toLocaleString("en-CA")}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{c.proposed.toLocaleString("en-CA")}</td>
                        <td className={"px-3 py-1.5 text-right " + (delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "text-sand-500")}>
                          {delta > 0 ? "+" : ""}{delta.toLocaleString("en-CA")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {skipped.length > 0 && (
            <details className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <summary className="cursor-pointer font-medium text-amber-900">Skipped rows ({skipped.length})</summary>
              <ul className="mt-2 ml-4 list-disc text-amber-900">
                {skipped.slice(0, 100).map((s, i) => (
                  <li key={i}><span className="font-mono">{s.sku}</span> — {s.reason}</li>
                ))}
                {skipped.length > 100 && <li>…and {skipped.length - 100} more.</li>}
              </ul>
            </details>
          )}
        </div>

        <div className="px-5 py-3 border-t border-sand-200/60 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={applying}
            className="px-4 py-1.5 text-sm rounded-lg border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={applying || changes.length === 0}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed">
            {applying ? "Applying…" : `Apply ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
