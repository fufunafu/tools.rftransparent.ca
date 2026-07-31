"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Store {
  id: string;
  label: string;
}

/**
 * Monthly net-revenue target per store. This is the number the operations
 * dashboard measures "30d vs target" against — deliberately a figure someone
 * commits to rather than the pipeline forecast, which moves on its own and
 * would make "vs target" mean "vs our own prediction".
 */
export default function SalesTargetsForm({
  stores,
  initial,
  canEdit,
}: {
  stores: Store[];
  initial: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(stores.map((s) => [s.id, initial[s.id] ? String(initial[s.id]) : ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/sales-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: draft }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save the targets");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-slate-900">Monthly sales target</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            What each store is aiming for in a month. The operations dashboard measures the last
            30 days against this. Leave one blank and that store simply shows no target.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save targets"}
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stores.map((store) => (
          <label key={store.id} className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">{store.label}</span>
            <span className="relative block">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                inputMode="numeric"
                value={draft[store.id] ?? ""}
                disabled={!canEdit}
                onChange={(e) => {
                  // Accept what people actually type — "420,000" or "$420000".
                  const cleaned = e.target.value.replace(/[^0-9]/g, "");
                  setDraft((d) => ({ ...d, [store.id]: cleaned }));
                  setSaved(false);
                }}
                placeholder="no target"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 text-sm tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
              />
            </span>
            {draft[store.id] && (
              <span className="block text-[11px] text-slate-400 mt-1 tabular-nums">
                ${Number(draft[store.id]).toLocaleString()} / month
              </span>
            )}
          </label>
        ))}
      </div>

      {!canEdit && (
        <p className="text-xs text-slate-400 mt-3">
          Only an admin can change targets — they decide whether the dashboard reads green or red.
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-600 mt-3">Saved.</p>}
    </section>
  );
}
