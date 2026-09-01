"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ShippingQuoteRow, ShippingQuoteSettings, StoredRate } from "@/lib/shipping-quotes";

type QuoteRow = ShippingQuoteRow & { store_label: string };

interface ListResponse {
  quotes: QuoteRow[];
  configured: boolean;
  origin_set: boolean;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : fallback;
}

const fieldClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none";

function money(value: number | null, currency = "CAD"): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)} ${currency}`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusPill({ status }: { status: QuoteRow["status"] }) {
  const styles: Record<QuoteRow["status"], string> = {
    quoted: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    no_rates: "bg-slate-100 text-slate-600 border-slate-200",
    error: "bg-red-50 text-red-700 border-red-200",
  };
  const labels: Record<QuoteRow["status"], string> = {
    quoted: "Quoted",
    pending: "Pending",
    no_rates: "No rates",
    error: "Error",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function RatesTable({ rates }: { rates: StoredRate[] }) {
  const sorted = [...rates].sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity));
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-1.5 pr-3">Carrier</th>
          <th className="py-1.5 pr-3">Service</th>
          <th className="py-1.5 pr-3">Transit</th>
          <th className="py-1.5 pr-3 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={`${r.service_id}-${i}`} className="border-t border-slate-100">
            <td className="py-1.5 pr-3 font-medium text-slate-800">{r.carrier}</td>
            <td className="py-1.5 pr-3 text-slate-600">{r.service}</td>
            <td className="py-1.5 pr-3 text-slate-600">
              {r.transit_days === null ? "—" : `${r.transit_days} day${r.transit_days === 1 ? "" : "s"}`}
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.total, r.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsPanel({
  canEdit,
  onSaved,
}: {
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<ShippingQuoteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/warehouse/shipping-quotes/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSettings(d.settings ?? null))
      .catch(() => setMessage("Could not load settings"));
  }, []);

  if (!settings) return <p className="text-sm text-slate-500">Loading settings…</p>;

  const o = settings.origin;
  const p = settings.default_package;
  const setOrigin = (k: keyof typeof o, v: string) =>
    setSettings({ ...settings, origin: { ...o, [k]: v } });
  const setPkg = (k: keyof typeof p, v: string) =>
    setSettings({ ...settings, default_package: { ...p, [k]: Number(v) } });

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/warehouse/shipping-quotes/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error(await responseError(res, "Save failed"));
      const data = await res.json();
      setSettings(data.settings);
      setMessage("Saved");
      onSaved();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const ro = !canEdit;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Ship-from address</h3>
        <p className="mt-1 text-xs text-slate-500">
          Every quote is priced from here. Freightcom needs the full street address and postal code.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input className={fieldClass} placeholder="Company name" value={o.name} disabled={ro} onChange={(e) => setOrigin("name", e.target.value)} />
          <input className={fieldClass} placeholder="Contact name" value={o.contact_name} disabled={ro} onChange={(e) => setOrigin("contact_name", e.target.value)} />
          <input className={fieldClass} placeholder="Street address" value={o.address_line_1} disabled={ro} onChange={(e) => setOrigin("address_line_1", e.target.value)} />
          <input className={fieldClass} placeholder="Unit / line 2" value={o.address_line_2} disabled={ro} onChange={(e) => setOrigin("address_line_2", e.target.value)} />
          <input className={fieldClass} placeholder="City" value={o.city} disabled={ro} onChange={(e) => setOrigin("city", e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <input className={fieldClass} placeholder="ON" value={o.region} disabled={ro} onChange={(e) => setOrigin("region", e.target.value)} />
            <input className={fieldClass} placeholder="CA" value={o.country} disabled={ro} onChange={(e) => setOrigin("country", e.target.value)} />
            <input className={fieldClass} placeholder="Postal" value={o.postal_code} disabled={ro} onChange={(e) => setOrigin("postal_code", e.target.value)} />
          </div>
          <input className={fieldClass} placeholder="Phone" value={o.phone} disabled={ro} onChange={(e) => setOrigin("phone", e.target.value)} />
          <input className={fieldClass} placeholder="Email (needed for US-bound quotes)" value={o.email} disabled={ro} onChange={(e) => setOrigin("email", e.target.value)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Default box</h3>
        <p className="mt-1 text-xs text-slate-500">
          Used when Shopify has no product weights on the order. Dimensions are always taken from here.
        </p>
        <div className="mt-3 grid grid-cols-4 gap-3">
          {(
            [
              ["weight_lb", "Weight (lb)"],
              ["length_in", "L (in)"],
              ["width_in", "W (in)"],
              ["height_in", "H (in)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-xs text-slate-500">
              {label}
              <input
                type="number"
                min={0}
                step="0.1"
                className={`${fieldClass} mt-1`}
                value={p[key]}
                disabled={ro}
                onChange={(e) => setPkg(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          Skip shipping methods containing (comma-separated)
          <input
            className={`${fieldClass} mt-1`}
            value={settings.skip_shipping_methods.join(", ")}
            disabled={ro}
            onChange={(e) =>
              setSettings({
                ...settings,
                skip_shipping_methods: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </label>
        <label className="text-xs text-slate-500">
          Max weight per package (lb) — heavier orders are split into several boxes
          <input
            type="number"
            min={1}
            max={500}
            className={`${fieldClass} mt-1`}
            value={settings.max_package_weight_lb}
            disabled={ro}
            onChange={(e) => setSettings({ ...settings, max_package_weight_lb: Number(e.target.value) })}
          />
        </label>
        <label className="text-xs text-slate-500">
          Auto-quote orders from the last N days
          <input
            type="number"
            min={1}
            max={60}
            className={`${fieldClass} mt-1`}
            value={settings.lookback_days}
            disabled={ro}
            onChange={(e) => setSettings({ ...settings, lookback_days: Number(e.target.value) })}
          />
        </label>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
          {message && <span className="text-sm text-slate-600">{message}</span>}
        </div>
      )}
    </div>
  );
}

export default function ShippingQuotes({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [showSettings, setShowSettings] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/warehouse/shipping-quotes?days=30", { cache: "no-store" });
      if (!res.ok) throw new Error(await responseError(res, "Could not load quotes"));
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quotes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requote = async (q: QuoteRow) => {
    const key = `${q.store_id}:${q.order_id}`;
    setBusy(key);
    try {
      const res = await fetch("/api/warehouse/shipping-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requote", storeId: q.store_id, orderId: q.order_id }),
      });
      if (!res.ok) throw new Error(await responseError(res, "Quote failed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quote failed");
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy("sync");
    setSyncMessage("");
    try {
      const res = await fetch("/api/warehouse/shipping-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!res.ok) throw new Error(await responseError(res, "Sync failed"));
      const { summary } = await res.json();
      setSyncMessage(
        summary.reason ??
          `${summary.scanned} orders checked · ${summary.quoted} new quotes · ${summary.skipped} pickup · ${summary.errors} errors`,
      );
      await load();
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const allQuotes = data?.quotes ?? [];
  // One tab per store that actually has quotes, in stable store-id order.
  const stores = [...new Map(allQuotes.map((q) => [q.store_id, q.store_label])).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, label]) => ({ id, label, count: allQuotes.filter((q) => q.store_id === id).length }));
  const quotes = storeFilter === "all" ? allQuotes : allQuotes.filter((q) => q.store_id === storeFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600">Logistics</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Shipping quotes</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Every unfulfilled Shopify order with a shipping address gets a default Freightcom quote
            automatically, about every 15 minutes. The cheapest option is shown first; open a row for
            every carrier that answered.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={runSync}
              disabled={busy !== null}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {busy === "sync" ? "Checking…" : "Check for new orders"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            {showSettings ? "Hide settings" : "Settings"}
          </button>
        </div>
      </div>

      {data && !data.configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Freightcom isn&apos;t connected yet. Add <code>FREIGHTCOM_API_KEY</code> (from the Freightcom
          portal, under API access) to the Vercel environment and redeploy.
        </div>
      )}
      {data && data.configured && !data.origin_set && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Set the ship-from address in Settings before quotes can run.
        </div>
      )}
      {syncMessage && <p className="text-sm text-slate-600">{syncMessage}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {showSettings && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SettingsPanel canEdit={canEdit} onSaved={load} />
        </section>
      )}

      {stores.length > 1 && (
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden w-fit">
          {[{ id: "all", label: "All stores", count: allQuotes.length }, ...stores].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStoreFilter(s.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                storeFilter === s.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s.label}
              <span className={`ml-1.5 text-xs ${storeFilter === s.id ? "text-slate-300" : "text-slate-400"}`}>
                {s.count}
              </span>
            </button>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : quotes.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No quotes yet. Once Freightcom is connected and the ship-from address is set, new orders
            will show up here on their own.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Order</th>
                  <th className="px-4 py-2.5">Ship to</th>
                  <th className="px-4 py-2.5">Method</th>
                  <th className="px-4 py-2.5">Package</th>
                  <th className="px-4 py-2.5">Cheapest</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const key = `${q.store_id}:${q.order_id}`;
                  const pkg = q.packages?.[0];
                  const dest = q.destination?.address;
                  const isOpen = open === key;
                  return (
                    <FragmentRow key={key}>
                      <tr
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                        onClick={() => setOpen(isOpen ? null : key)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{q.order_name}</div>
                          <div className="text-xs text-slate-500">
                            {q.store_label} · {when(q.order_created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-800">{q.customer_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">
                            {dest ? `${dest.city}, ${dest.region} ${dest.postal_code}` : "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{q.shipping_method ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {pkg ? (
                            <>
                              {pkg.measurements.weight.value} lb ·{" "}
                              {pkg.measurements.cuboid.l}×{pkg.measurements.cuboid.w}×{pkg.measurements.cuboid.h} in
                              {q.weight_source === "default" && (
                                <span className="ml-1 text-xs text-amber-600" title="No weight on the Shopify order; default box used">
                                  (default)
                                </span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {q.cheapest ? (
                            <>
                              <div className="font-medium text-slate-900">{q.cheapest.carrier}</div>
                              <div className="text-xs text-slate-500">
                                {q.cheapest.service}
                                {q.cheapest.transit_days !== null && ` · ${q.cheapest.transit_days}d`}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {q.cheapest ? money(q.cheapest.total, q.cheapest.currency) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={q.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void requote(q);
                            }}
                            disabled={busy !== null}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {busy === key ? "Quoting…" : "Requote"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-slate-100 bg-slate-50/60">
                          <td colSpan={8} className="px-4 py-4">
                            {q.error && <p className="mb-3 text-sm text-red-600">{q.error}</p>}
                            {q.rates && q.rates.length > 0 ? (
                              <RatesTable rates={q.rates} />
                            ) : (
                              <p className="text-sm text-slate-500">No carrier rates on file.</p>
                            )}
                            <p className="mt-3 text-xs text-slate-500">
                              Quoted {when(q.quoted_at)}
                              {q.cheapest?.valid_until && ` · valid until ${q.cheapest.valid_until}`}
                              {q.rate_request_id && ` · Freightcom ref ${q.rate_request_id}`}
                            </p>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
