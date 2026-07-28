"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Store {
  id: string;
  label: string;
}

interface PurchasingSummary {
  lead_time_days: number;
  expected_fill: number;
  crate_size: number;
  annual_growth_pct: number;
  restock_cover_pct: number;
}

// month_index is the month being forecast, so index 0 is the Dec→Jan step.
const TRANSITIONS = [
  "Dec→Jan", "Jan→Feb", "Feb→Mar", "Mar→Apr", "Apr→May", "May→Jun",
  "Jun→Jul", "Jul→Aug", "Aug→Sep", "Sep→Oct", "Oct→Nov", "Nov→Dec",
];

type Draft = Record<string, Record<number, string>>;

function buildDraft(
  stores: Store[],
  initial: Record<string, Record<number, number>>,
  defaults: Record<number, number>
): Draft {
  const draft: Draft = {};
  for (const store of stores) {
    draft[store.id] = {};
    for (let i = 0; i < 12; i++) {
      const rate = initial[store.id]?.[i] ?? defaults[i] ?? 0;
      draft[store.id][i] = String(Math.round(rate * 100));
    }
  }
  return draft;
}

export default function RatesForm({
  stores,
  initial,
  defaults,
  purchasing,
}: {
  stores: Store[];
  initial: Record<string, Record<number, number>>;
  defaults: Record<number, number>;
  purchasing: PurchasingSummary;
}) {
  const router = useRouter();
  // Lazy init — building the grid is cheap but pointless to redo every render.
  const [draft, setDraft] = useState<Draft>(() => buildDraft(stores, initial, defaults));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const baseline = buildDraft(stores, initial, defaults);
  const changedStores = stores
    .filter((s) => Array.from({ length: 12 }, (_, i) => i).some((i) => draft[s.id][i] !== baseline[s.id][i]))
    .map((s) => s.id);

  function setCell(storeId: string, month: number, value: string) {
    setDraft((prev) => ({ ...prev, [storeId]: { ...prev[storeId], [month]: value } }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    for (const storeId of changedStores) {
      for (let i = 0; i < 12; i++) {
        const n = parseFloat(draft[storeId][i]);
        if (!Number.isFinite(n) || n < -100 || n > 500) {
          setError(`${TRANSITIONS[i]} must be a percentage between -100 and 500.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      // One request per store — the endpoint keys on storeId.
      for (const storeId of changedStores) {
        const rates: Record<string, number> = {};
        for (let i = 0; i < 12; i++) rates[i] = parseFloat(draft[storeId][i]) / 100;
        const res = await fetch("/api/settings/forecast-rates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rates, storeId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Could not save ${storeId}`);
        }
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-sand-900">Rates &amp; Thresholds</h2>
        <p className="text-sm text-sand-500 mt-1">
          The numbers the forecasting and reordering math leans on when it has no real data to go by.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {savedAt && !error && changedStores.length === 0 && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          Saved.
        </div>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-sand-900">Seasonal fallback rates</h3>
          <p className="text-xs text-sand-500 mt-1">
            Expected month-over-month revenue change, used by the sales forecast only for months
            with no Shopify history (before July 2025). +100% means the month is expected to double.
            The Pipeline page edits one store at a time — this is all of them side by side.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200">
                <th className="text-left font-medium text-sand-500 text-xs uppercase py-2 pr-4">Month</th>
                {stores.map((store) => (
                  <th key={store.id} className="text-right font-medium text-sand-500 text-xs uppercase py-2 px-2">
                    {store.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TRANSITIONS.map((label, i) => (
                <tr key={label} className="border-b border-sand-100 last:border-0">
                  <td className="py-1.5 pr-4 text-sand-700 whitespace-nowrap">{label}</td>
                  {stores.map((store) => (
                    <td key={store.id} className="py-1.5 px-2">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          step="1"
                          value={draft[store.id][i]}
                          onChange={(e) => setCell(store.id, i, e.target.value)}
                          aria-label={`${store.label} ${label}`}
                          className="w-20 px-2 py-1 text-sm text-right rounded-lg border border-sand-200 focus:border-accent focus:outline-none"
                        />
                        <span className="text-xs text-sand-400">%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-sand-900">Reorder algorithm</h3>
          <p className="text-xs text-sand-500 mt-1">
            What drives the Reorder page&apos;s suggestions. Edited on the Purchasing settings page,
            alongside the month-by-month seasonality multipliers and the recompute tool.
          </p>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat label="Lead time" value={`${purchasing.lead_time_days} days`} />
          <Stat label="Expected fill" value={`${Math.round(purchasing.expected_fill * 100)}%`} />
          <Stat label="Crate size" value={String(purchasing.crate_size)} />
          <Stat label="Annual growth" value={`${purchasing.annual_growth_pct}%`} />
          <Stat label="Target at arrival" value={`${purchasing.restock_cover_pct}%`} />
        </dl>
        <Link
          href="/warehouse/purchasing/settings"
          className="inline-block text-xs font-medium text-accent hover:underline"
        >
          Edit on the Purchasing settings page →
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || changedStores.length === 0}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {changedStores.length > 0 && (
          <span className="text-xs text-sand-500">
            Unsaved changes to {changedStores.length} store{changedStores.length === 1 ? "" : "s"}.
          </span>
        )}
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-sand-500">{label}</dt>
      <dd className="text-sm font-medium text-sand-900 mt-0.5">{value}</dd>
    </div>
  );
}
