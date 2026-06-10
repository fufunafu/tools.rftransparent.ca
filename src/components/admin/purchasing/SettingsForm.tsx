"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PurchasingSettings } from "@/lib/purchasing/types";

interface Props {
  initialSettings: PurchasingSettings;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface StoreResult {
  storeId: string;
  label: string;
  orders: number;
  revenue: number;
  error?: string;
}

interface RecomputeResponse {
  status: string;
  avg_monthly_revenue: number;
  multipliers: number[];
  perStore: StoreResult[];
  monthBreakdown: Array<{ monthKey: string; monthIdx: number; revenue: number; multiplier: number }>;
}

// Color a month chip by how far above/below 1.0 it sits.
function multColor(m: number): string {
  if (m >= 1.4) return "bg-amber-100 text-amber-800 border-amber-300";
  if (m >= 1.1) return "bg-amber-50 text-amber-700 border-amber-200";
  if (m <= 0.6) return "bg-blue-100 text-blue-800 border-blue-300";
  if (m <= 0.9) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-sand-50 text-sand-700 border-sand-200";
}

export default function SettingsForm({ initialSettings }: Props) {
  const router = useRouter();
  const [leadDays, setLeadDays] = useState(String(initialSettings.lead_time_days));
  const [expectedFillPct, setExpectedFillPct] = useState(
    String(Math.round(initialSettings.expected_fill * 100)),
  );
  const [crateSize, setCrateSize] = useState(String(initialSettings.crate_size));
  const [multipliers, setMultipliers] = useState<string[]>(
    initialSettings.season_multipliers.map((n) => String(n)),
  );
  const [annualGrowth, setAnnualGrowth] = useState(
    String(initialSettings.annual_growth_pct),
  );
  const [coverPct, setCoverPct] = useState(
    String(initialSettings.restock_cover_pct),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeResponse | null>(null);

  function setMonth(i: number, v: string) {
    setMultipliers((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }

  const dirty =
    leadDays !== String(initialSettings.lead_time_days) ||
    expectedFillPct !== String(Math.round(initialSettings.expected_fill * 100)) ||
    crateSize !== String(initialSettings.crate_size) ||
    multipliers.some((m, i) => m !== String(initialSettings.season_multipliers[i])) ||
    annualGrowth !== String(initialSettings.annual_growth_pct) ||
    coverPct !== String(initialSettings.restock_cover_pct);

  async function recompute() {
    setRecomputing(true);
    setError(null);
    setRecomputeResult(null);
    try {
      const res = await fetch("/api/purchasing/settings/recompute-seasonality", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Recompute failed");
      }
      setRecomputeResult(data as RecomputeResponse);
      setMultipliers((data.multipliers as number[]).map((n) => String(n)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lead = parseInt(leadDays, 10);
    const fillPct = parseFloat(expectedFillPct);
    const crate = parseFloat(crateSize);
    if (!Number.isFinite(lead) || lead < 0) {
      setError("Lead time days must be a positive whole number.");
      return;
    }
    if (!Number.isFinite(fillPct) || fillPct < 0 || fillPct > 200) {
      setError("Expected fill % must be between 0 and 200.");
      return;
    }
    if (!Number.isFinite(crate) || crate <= 0) {
      setError("Crate size must be a positive number.");
      return;
    }
    const mults = multipliers.map((s) => parseFloat(s));
    if (mults.length !== 12 || mults.some((n) => !Number.isFinite(n) || n <= 0)) {
      setError("Each month multiplier must be a positive number.");
      return;
    }
    const growthPct = parseFloat(annualGrowth);
    if (!Number.isFinite(growthPct) || growthPct < -100 || growthPct > 1000) {
      setError("Annual growth must be a number between -100 and 1000.");
      return;
    }
    const cover = parseFloat(coverPct);
    if (!Number.isFinite(cover) || cover < 0 || cover > 500) {
      setError("Target at arrival % must be between 0 and 500.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/purchasing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_time_days: lead,
          expected_fill: fillPct / 100,
          crate_size: crate,
          season_multipliers: mults,
          annual_growth_pct: growthPct,
          restock_cover_pct: cover,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
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
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {savedAt && !error && !dirty && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          Saved.
        </div>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-sand-900">
            Reorder algorithm
          </h2>
          <p className="text-sm text-sand-500 mt-1">
            These values drive the Reorder page&apos;s suggestions and the
            status labels on the Inventory page.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <Field
            label="Lead time days"
            help="How long a PO usually takes to arrive — also doubles as the safety buffer. 90 is the safe default for shipments from China. Drop to 60 if your supplier is reliable; raise to 120 if shipments tend to slip."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={leadDays}
                onChange={(e) => setLeadDays(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-sand-300 tabular-nums"
              />
              <span className="text-sm text-sand-500">days</span>
            </div>
          </Field>
          <Field
            label="Crate size"
            help="Units per crate from the supplier. Suggested order quantities round to whole crates (or a half-crate for small needs) so we never end up with awkward fractions like 2.5 crates."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                step="1"
                value={crateSize}
                onChange={(e) => setCrateSize(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-sand-300 tabular-nums"
              />
              <span className="text-sm text-sand-500">units / crate</span>
            </div>
          </Field>
          <Field
            label="Target at arrival"
            help="How much stock to still have on the shelf when a new PO lands, as a percent of one lead time of sales. 100 = a full lead time (~90 days of cover), 75 = three-quarters, 150 = one and a half. Higher = order earlier and more."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="500"
                step="1"
                value={coverPct}
                onChange={(e) => setCoverPct(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-sand-300 tabular-nums"
              />
              <span className="text-sm text-sand-500">%</span>
            </div>
          </Field>
          <Field
            label="Expected fill"
            help="Floor on the restock target, as a percent of capacity — keeps slow movers from going bare. The stock to have left when a PO arrives is the higher of this floor or lead-time sales + buffer, capped at capacity."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="200"
                step="1"
                value={expectedFillPct}
                onChange={(e) => setExpectedFillPct(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-sand-300 tabular-nums"
              />
              <span className="text-sm text-sand-500">%</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-sand-900">Seasonality</h2>
            <p className="text-sm text-sand-500 mt-1">
              Each month gets its own multiplier. <strong>1.0</strong> means
              &ldquo;sells at the yearly average,&rdquo; <strong>1.5</strong>
              {" "}means 50% above, <strong>0.5</strong> means half. The
              current month&apos;s value scales days-of-stock, reorder point,
              suggested qty, and SOP status; the forecast chart applies each
              future month&apos;s own value.
            </p>
            <p className="text-xs text-sand-500 mt-2">
              <em>Recompute from Shopify</em> pulls the last 12 completed
              months from RF Transparent and Glass Railing Store (BC is
              excluded). The 12 multipliers come out averaging to ~1.0 by
              construction — you can still hand-edit individual months after.
            </p>
          </div>
          <button
            type="button"
            onClick={recompute}
            disabled={recomputing}
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recomputing ? "Pulling…" : "Recompute from Shopify"}
          </button>
        </div>

        {recomputeResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-xs space-y-1.5">
            <div className="font-medium text-blue-900">
              Imported {recomputeResult.perStore.reduce((s, r) => s + r.orders, 0).toLocaleString("en-CA")} orders.
              Yearly avg: ${recomputeResult.avg_monthly_revenue.toLocaleString("en-CA")}/month.
            </div>
            <ul className="text-blue-800 space-y-0.5">
              {recomputeResult.perStore.map((s) => (
                <li key={s.storeId}>
                  · {s.label}: {s.orders.toLocaleString("en-CA")} orders,
                  ${Math.round(s.revenue).toLocaleString("en-CA")}
                  {s.error && <span className="text-red-600"> — {s.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[200px,1fr] gap-5 items-start">
          <Field
            label="Annual growth"
            help="Year-over-year sales lift on top of seasonality. 20 = expect 20% more than last year across every month. 0 = no lift. Negative is allowed for a planned downturn."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="-100"
                max="1000"
                step="1"
                value={annualGrowth}
                onChange={(e) => setAnnualGrowth(e.target.value)}
                className="w-24 px-3 py-2 rounded-lg border border-sand-300 tabular-nums"
              />
              <span className="text-sm text-sand-500">%</span>
            </div>
          </Field>
          <div>
            <div className="text-xs uppercase tracking-wider text-sand-400 font-medium mb-2">
              Monthly multipliers
              <span className="ml-2 text-[10px] normal-case tracking-normal text-sand-400">
                (top = shape only; bottom = effective with growth applied)
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
              {MONTH_NAMES.map((name, i) => {
                const val = parseFloat(multipliers[i] ?? "1");
                const safe = Number.isFinite(val) ? val : 1;
                const growth = parseFloat(annualGrowth);
                const growthFactor = Number.isFinite(growth) ? 1 + growth / 100 : 1;
                const effective = safe * growthFactor;
                return (
                  <div
                    key={name}
                    className={
                      "rounded-lg border p-2 text-center " + multColor(effective)
                    }
                  >
                    <div className="text-[11px] text-sand-500 font-medium mb-1.5">
                      {name}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={multipliers[i] ?? ""}
                      onChange={(e) => setMonth(i, e.target.value)}
                      className="w-full px-1 py-1 text-center text-sm tabular-nums rounded border border-sand-300 bg-white focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {Math.abs(growthFactor - 1) > 0.001 && (
                      <div
                        className="mt-1 text-[10px] tabular-nums text-sand-600"
                        title={`${safe.toFixed(2)} × ${growthFactor.toFixed(2)}`}
                      >
                        = {effective.toFixed(2)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 sticky bottom-0 bg-sand-50/95 backdrop-blur-sm rounded-xl border border-sand-200/60 px-4 py-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && (
          <span className="text-xs text-sand-500">You have unsaved changes.</span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-sand-900 mb-1">{label}</div>
      <p className="text-xs text-sand-500 mb-2">{help}</p>
      {children}
    </div>
  );
}
