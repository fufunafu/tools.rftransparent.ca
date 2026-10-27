"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ShippingQuoteRow,
  ShippingQuoteSettings,
  StoredRate,
} from "@/lib/shipping-quotes";

type QuoteRow = ShippingQuoteRow & { store_label: string };
type StatusFilter = "all" | "quoted" | "pending" | "attention";
type DateRange = 7 | 30 | 90;

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
  "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";
const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function money(value: number | null, currency = "CAD"): string {
  if (value === null) return "N/A";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

function when(iso: string | null): string {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function transitLabel(days: number | null): string {
  if (days === null) return "Transit time unavailable";
  return `${days} business day${days === 1 ? "" : "s"}`;
}

function quoteKey(quote: QuoteRow): string {
  return `${quote.store_id}:${quote.order_id}`;
}

function StatusPill({ status }: { status: QuoteRow["status"] }) {
  const styles: Record<QuoteRow["status"], string> = {
    quoted: "border-emerald-200 bg-emerald-50 text-emerald-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    no_rates: "border-slate-200 bg-slate-100 text-slate-600",
    error: "border-red-200 bg-red-50 text-red-700",
  };
  const labels: Record<QuoteRow["status"], string> = {
    quoted: "Quoted",
    pending: "Pending",
    no_rates: "No rates",
    error: "Needs attention",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function RatesList({ rates }: { rates: StoredRate[] }) {
  const sorted = [...rates].sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity));
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_140px_120px] gap-4 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:grid">
        <span>Carrier</span>
        <span>Service</span>
        <span>Transit</span>
        <span className="text-right">Total</span>
      </div>
      {sorted.map((rate, index) => (
        <div
          key={`${rate.service_id}-${index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_140px_120px] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-slate-900">{rate.carrier}</span>
              {index === 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                  Best price
                </span>
              )}
            </div>
            <p className="truncate text-xs text-slate-500 sm:hidden">{rate.service}</p>
          </div>
          <p className="row-span-2 text-right font-bold tabular-nums text-slate-950 sm:row-span-1">
            {money(rate.total, rate.currency)}
          </p>
          <p className="hidden truncate text-sm text-slate-600 sm:block">{rate.service}</p>
          <p className="text-xs text-slate-500 sm:text-sm">{transitLabel(rate.transit_days)}</p>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm font-semibold text-slate-700 ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{hint}</span>}
    </label>
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
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/warehouse/shipping-quotes/settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load settings"));
        return response.json();
      })
      .then((data) => setSettings(data.settings ?? null))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(error instanceof Error ? error.message : "Could not load settings");
        setMessageIsError(true);
      });
    return () => controller.abort();
  }, []);

  if (!settings && !message) {
    return (
      <div className="space-y-3" aria-label="Loading settings">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return <p className="text-sm font-medium text-red-700">{message}</p>;
  }

  const origin = settings.origin;
  const pkg = settings.default_package;
  const setOrigin = (key: keyof typeof origin, value: string) =>
    setSettings({ ...settings, origin: { ...origin, [key]: value } });
  const setPackage = (key: keyof typeof pkg, value: string) =>
    setSettings({ ...settings, default_package: { ...pkg, [key]: Number(value) } });

  const save = async () => {
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await fetch("/api/warehouse/shipping-quotes/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Save failed"));
      const data = await response.json();
      setSettings(data.settings);
      setMessage("Settings saved");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
      setMessageIsError(true);
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canEdit;
  return (
    <div className="space-y-7">
      {!canEdit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          You can review these settings. A manager can make changes.
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-4">
        <legend className="text-base font-bold text-slate-950">Ship-from address</legend>
        <p className="text-sm leading-6 text-slate-500">
          Freightcom prices every order from this location. Complete contact details are required for
          cross-border quotes.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <input className={`${fieldClass} mt-1.5`} value={origin.name} onChange={(event) => setOrigin("name", event.target.value)} autoComplete="organization" />
          </Field>
          <Field label="Contact name">
            <input className={`${fieldClass} mt-1.5`} value={origin.contact_name} onChange={(event) => setOrigin("contact_name", event.target.value)} autoComplete="name" />
          </Field>
          <Field label="Street address" className="sm:col-span-2">
            <input className={`${fieldClass} mt-1.5`} value={origin.address_line_1} onChange={(event) => setOrigin("address_line_1", event.target.value)} autoComplete="address-line1" />
          </Field>
          <Field label="Unit or suite">
            <input className={`${fieldClass} mt-1.5`} value={origin.address_line_2} onChange={(event) => setOrigin("address_line_2", event.target.value)} autoComplete="address-line2" />
          </Field>
          <Field label="City">
            <input className={`${fieldClass} mt-1.5`} value={origin.city} onChange={(event) => setOrigin("city", event.target.value)} autoComplete="address-level2" />
          </Field>
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[1fr_1fr_1.4fr]">
            <Field label="Province or state">
              <input className={`${fieldClass} mt-1.5 uppercase`} value={origin.region} maxLength={3} onChange={(event) => setOrigin("region", event.target.value)} autoComplete="address-level1" />
            </Field>
            <Field label="Country">
              <input className={`${fieldClass} mt-1.5 uppercase`} value={origin.country} maxLength={2} onChange={(event) => setOrigin("country", event.target.value)} autoComplete="country" />
            </Field>
            <Field label="Postal or ZIP code">
              <input className={`${fieldClass} mt-1.5 uppercase`} value={origin.postal_code} onChange={(event) => setOrigin("postal_code", event.target.value)} autoComplete="postal-code" />
            </Field>
          </div>
          <Field label="Phone">
            <input type="tel" className={`${fieldClass} mt-1.5`} value={origin.phone} onChange={(event) => setOrigin("phone", event.target.value)} autoComplete="tel" />
          </Field>
          <Field label="Email" hint="Required for US-bound quotes.">
            <input type="email" className={`${fieldClass} mt-1.5`} value={origin.email} onChange={(event) => setOrigin("email", event.target.value)} autoComplete="email" />
          </Field>
        </div>
      </fieldset>

      <div className="border-t border-slate-200" />

      <fieldset disabled={readOnly} className="space-y-4">
        <legend className="text-base font-bold text-slate-950">Package defaults</legend>
        <p className="text-sm leading-6 text-slate-500">
          Dimensions always come from this box. Weight is used only when Shopify has no product weight.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["weight_lb", "Weight", "lb"],
              ["length_in", "Length", "in"],
              ["width_in", "Width", "in"],
              ["height_in", "Height", "in"],
            ] as const
          ).map(([key, label, unit]) => (
            <Field key={key} label={`${label} (${unit})`}>
              <input
                type="number"
                min={0}
                step="0.1"
                className={`${fieldClass} mt-1.5`}
                value={pkg[key]}
                onChange={(event) => setPackage(key, event.target.value)}
              />
            </Field>
          ))}
        </div>
      </fieldset>

      <div className="border-t border-slate-200" />

      <fieldset disabled={readOnly} className="space-y-4">
        <legend className="text-base font-bold text-slate-950">Glass crates (LTL)</legend>
        <p className="text-xs text-slate-500">
          Orders containing glass are quoted as LTL freight: one crate per {settings.crate.glass_per_crate}{" "}
          glass, hardware packed inside the crates. Set the crate size from a past LTL booking — the
          freight class is calculated automatically.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {(
            [
              ["glass_per_crate", "Glass per crate", ""],
              ["length_in", "Length", "in"],
              ["width_in", "Width", "in"],
              ["height_in", "Height", "in"],
              ["tare_lb", "Empty crate", "lb"],
            ] as const
          ).map(([key, label, unit]) => (
            <Field key={key} label={unit ? `${label} (${unit})` : label}>
              <input
                type="number"
                min={0}
                step="0.1"
                className={`${fieldClass} mt-1.5`}
                value={settings.crate[key]}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    crate: { ...settings.crate, [key]: Number(event.target.value) },
                  })
                }
              />
            </Field>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Glass SKU prefixes" hint="Comma-separated. Items whose SKU starts with one of these count as glass.">
            <input
              className={`${fieldClass} mt-1.5`}
              value={settings.crate.glass_sku_prefixes.join(", ")}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  crate: {
                    ...settings.crate,
                    glass_sku_prefixes: event.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                  },
                })
              }
            />
          </Field>
          <Field label="Glass title keywords" hint="Used for items without a SKU.">
            <input
              className={`${fieldClass} mt-1.5`}
              value={settings.crate.glass_title_keywords.join(", ")}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  crate: {
                    ...settings.crate,
                    glass_title_keywords: event.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                  },
                })
              }
            />
          </Field>
        </div>
      </fieldset>

      <div className="border-t border-slate-200" />

      <fieldset disabled={readOnly} className="space-y-4">
        <legend className="text-base font-bold text-slate-950">Automation rules</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ignored shipping methods"
            hint="Separate terms with commas. Matching orders, such as pickup orders, will not be quoted."
            className="sm:col-span-2"
          >
            <input
              className={`${fieldClass} mt-1.5`}
              value={settings.skip_shipping_methods.join(", ")}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  skip_shipping_methods: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Maximum package weight (lb)" hint="Heavier orders are split across multiple boxes.">
            <input
              type="number"
              min={1}
              max={500}
              className={`${fieldClass} mt-1.5`}
              value={settings.max_package_weight_lb}
              onChange={(event) => setSettings({ ...settings, max_package_weight_lb: Number(event.target.value) })}
            />
          </Field>
          <Field label="Order lookback (days)" hint="New-order checks scan this many days of Shopify orders.">
            <input
              type="number"
              min={1}
              max={60}
              className={`${fieldClass} mt-1.5`}
              value={settings.lookback_days}
              onChange={(event) => setSettings({ ...settings, lookback_days: Number(event.target.value) })}
            />
          </Field>
        </div>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
          {message && (
            <span
              role="status"
              className={`text-sm font-semibold ${messageIsError ? "text-red-700" : "text-emerald-700"}`}
            >
              {message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "slate" | "green" | "amber" | "blue";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    green: "border-emerald-200 bg-emerald-50/60",
    amber: "border-amber-200 bg-amber-50/60",
    blue: "border-blue-200 bg-blue-50/60",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tabular-nums tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function QuoteDetails({ quote }: { quote: QuoteRow }) {
  return (
    <div className="space-y-3">
      {quote.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {quote.error}
        </div>
      )}
      {quote.rates && quote.rates.length > 0 ? (
        <RatesList rates={quote.rates} />
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No carrier rates are on file for this order.
        </p>
      )}
      <p className="text-xs leading-5 text-slate-500">
        Quoted {when(quote.quoted_at)}
        {quote.cheapest?.valid_until && ` | Valid until ${quote.cheapest.valid_until}`}
        {quote.rate_request_id && ` | Freightcom reference ${quote.rate_request_id}`}
      </p>
    </div>
  );
}

function QuoteMobileCard({
  quote,
  expanded,
  busy,
  onToggle,
  onRequote,
}: {
  quote: QuoteRow;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onRequote: () => void;
}) {
  const destination = quote.destination?.address;
  const pkg = quote.packages?.[0];
  const detailsId = `mobile-quote-${quoteKey(quote).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-slate-950">{quote.order_name}</h3>
            <StatusPill status={quote.status} />
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {quote.store_label} | {when(quote.order_created_at)}
          </p>
        </div>
        {quote.cheapest && (
          <p className="shrink-0 text-right text-base font-extrabold tabular-nums text-slate-950">
            {money(quote.cheapest.total, quote.cheapest.currency)}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Ship to</p>
          <p className="mt-1 font-semibold text-slate-800">{quote.customer_name ?? "No customer name"}</p>
          <p className="text-xs text-slate-500">
            {destination
              ? `${destination.city}, ${destination.region} ${destination.postal_code}`
              : "No destination"}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Best option</p>
          <p className="mt-1 font-semibold text-slate-800">{quote.cheapest?.carrier ?? "Not quoted"}</p>
          <p className="text-xs text-slate-500">{quote.cheapest?.service ?? quote.shipping_method ?? "N/A"}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Package</p>
          <p className="mt-1 text-slate-600">
            {pkg
              ? `${quote.packages.length} ${
                  "freight_class" in pkg
                    ? `crate${quote.packages.length === 1 ? "" : "s"}`
                    : `box${quote.packages.length === 1 ? "" : "es"}`
                } × ${pkg.measurements.weight.value} lb | ${pkg.measurements.cuboid.l} x ${pkg.measurements.cuboid.w} x ${pkg.measurements.cuboid.h} in`
              : "Package details unavailable"}
            {pkg && "freight_class" in pkg && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                LTL class {pkg.freight_class}
              </span>
            )}
            {quote.weight_source === "default" && (
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                Default weight
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="min-h-10 flex-1 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700"
        >
          {expanded ? "Hide rates" : `View all rates${quote.rates?.length ? ` (${quote.rates.length})` : ""}`}
        </button>
        <button
          type="button"
          onClick={onRequote}
          disabled={busy}
          className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 disabled:opacity-50"
        >
          {busy ? "Quoting..." : "Requote"}
        </button>
      </div>
      {expanded && (
        <div id={detailsId} className="mt-4 border-t border-slate-100 pt-4">
          <QuoteDetails quote={quote} />
        </div>
      )}
    </article>
  );
}

export default function ShippingQuotes({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState<DateRange>(30);
  const [showSettings, setShowSettings] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    setRefreshing(true);
    try {
      const response = await fetch(`/api/warehouse/shipping-quotes?days=${days}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not load quotes"));
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load quotes");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const requote = async (quote: QuoteRow) => {
    const key = quoteKey(quote);
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/warehouse/shipping-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requote", storeId: quote.store_id, orderId: quote.order_id }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Quote failed"));
      await load();
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Quote failed");
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy("sync");
    setSyncMessage("");
    setError("");
    try {
      const response = await fetch("/api/warehouse/shipping-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Order check failed"));
      const { summary } = await response.json();
      setSyncMessage(
        summary.reason ??
          `${summary.scanned} orders checked | ${summary.quoted} new quotes | ${summary.skipped} pickups skipped | ${summary.errors} errors`,
      );
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Order check failed");
    } finally {
      setBusy(null);
    }
  };

  const runRequoteAll = async () => {
    if (
      !window.confirm(
        "Clear every stored quote and requote all orders with the current packing rules? This takes a few minutes.",
      )
    )
      return;
    setBusy("requote_all");
    setSyncMessage("");
    setError("");
    try {
      const response = await fetch("/api/warehouse/shipping-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requote_all" }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Requote failed"));
      const { cleared, summary } = await response.json();
      setSyncMessage(
        summary.reason ??
          `${cleared} old quotes cleared | ${summary.quoted} requoted so far | the automation finishes the rest within 15 minutes`,
      );
      await load();
    } catch (requoteError) {
      setError(requoteError instanceof Error ? requoteError.message : "Requote failed");
    } finally {
      setBusy(null);
    }
  };

  const allQuotes = useMemo(() => data?.quotes ?? [], [data?.quotes]);
  const stores = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const quote of allQuotes) {
      const current = counts.get(quote.store_id);
      counts.set(quote.store_id, {
        label: quote.store_label,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...counts.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([id, value]) => ({ id, ...value }));
  }, [allQuotes]);

  const stats = useMemo(() => {
    const quoted = allQuotes.filter((quote) => quote.status === "quoted").length;
    const attention = allQuotes.filter(
      (quote) => quote.status === "error" || quote.status === "no_rates",
    ).length;
    const latest = allQuotes.reduce<string | null>((mostRecent, quote) => {
      const value = quote.quoted_at ?? quote.requested_at;
      if (!value || (mostRecent && value <= mostRecent)) return mostRecent;
      return value;
    }, null);
    return { quoted, attention, latest };
  }, [allQuotes]);

  const quotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allQuotes.filter((quote) => {
      if (storeFilter !== "all" && quote.store_id !== storeFilter) return false;
      if (statusFilter === "quoted" && quote.status !== "quoted") return false;
      if (statusFilter === "pending" && quote.status !== "pending") return false;
      if (
        statusFilter === "attention" &&
        quote.status !== "error" &&
        quote.status !== "no_rates"
      ) {
        return false;
      }
      if (!term) return true;
      const destination = quote.destination?.address;
      return [
        quote.order_name,
        quote.customer_name,
        quote.shipping_method,
        quote.store_label,
        destination?.city,
        destination?.region,
        destination?.postal_code,
        quote.cheapest?.carrier,
        quote.cheapest?.service,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [allQuotes, search, statusFilter, storeFilter]);

  const clearFilters = () => {
    setSearch("");
    setStoreFilter("all");
    setStatusFilter("all");
  };
  const hasFilters = search.trim() !== "" || storeFilter !== "all" || statusFilter !== "all";

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50/70 p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-blue-600">Logistics</p>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                Auto-checks every 15 minutes
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
              Shipping quotes
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
              Compare Freightcom rates for unfulfilled Shopify orders, review exceptions, and requote
              an order when its package or destination changes.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:justify-end">
            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing || busy !== null}
              className={secondaryButtonClass}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={busy !== null || refreshing}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "sync" ? "Checking..." : "Find new orders"}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => void runRequoteAll()}
                disabled={busy !== null || refreshing}
                className={secondaryButtonClass}
              >
                {busy === "requote_all" ? "Requoting..." : "Requote all"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSettings((visible) => !visible)}
              aria-expanded={showSettings}
              aria-controls="shipping-settings"
              className={`${secondaryButtonClass} col-span-2`}
            >
              {showSettings ? "Close settings" : "Quote settings"}
            </button>
          </div>
        </div>
      </header>

      {data && !data.configured && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Freightcom is not connected</p>
          <p className="mt-1 leading-6">
            {canEdit
              ? "Add FREIGHTCOM_API_KEY to the Vercel environment, then redeploy before checking orders."
              : "Ask a manager to finish the Freightcom connection before checking orders."}
          </p>
        </div>
      )}
      {data && data.configured && !data.origin_set && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold">Ship-from address required</p>
            <p className="mt-1">Complete the origin address before Freightcom can return rates.</p>
          </div>
          <button type="button" onClick={() => setShowSettings(true)} className="min-h-10 rounded-xl bg-amber-900 px-4 font-bold text-white">
            Open settings
          </button>
        </div>
      )}
      {syncMessage && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {syncMessage}
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-medium">{error}</span>
          <button type="button" onClick={() => void load()} className="min-h-9 rounded-lg border border-red-300 bg-white px-3 font-bold">
            Try again
          </button>
        </div>
      )}

      {showSettings && (
        <section id="shipping-settings" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600">Configuration</p>
              <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">Quote settings</h2>
            </div>
            <button type="button" onClick={() => setShowSettings(false)} className="min-h-10 rounded-xl px-3 text-sm font-bold text-slate-500 hover:bg-slate-100">
              Close
            </button>
          </div>
          <SettingsPanel canEdit={canEdit} onSaved={() => void load()} />
        </section>
      )}

      <section aria-label="Quote overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Orders" value={allQuotes.length} detail={`Last ${days} days`} />
        <SummaryCard
          label="Quoted"
          value={stats.quoted}
          detail={allQuotes.length ? `${Math.round((stats.quoted / allQuotes.length) * 100)}% coverage` : "No orders yet"}
          tone="green"
        />
        <SummaryCard
          label="Needs attention"
          value={stats.attention}
          detail={stats.attention ? "Errors or no rates" : "Nothing to resolve"}
          tone={stats.attention ? "amber" : "slate"}
        />
        <SummaryCard
          label="Last quote"
          value={stats.latest ? when(stats.latest).split(",")[0] : "None"}
          detail={stats.latest ? when(stats.latest) : "Waiting for the first quote"}
          tone="blue"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1 xl:max-w-md">
              <span className="sr-only">Search shipping quotes</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400">
                <path d="m14.5 14.5 3 3m-1.5-8A6.5 6.5 0 1 1 3 9.5a6.5 6.5 0 0 1 13 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, customer, city, carrier..."
                className={`${fieldClass} pl-9`}
              />
            </label>
            <label>
              <span className="sr-only">Filter by quote status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className={`${fieldClass} sm:w-44`}>
                <option value="all">All statuses</option>
                <option value="quoted">Quoted</option>
                <option value="pending">Pending</option>
                <option value="attention">Needs attention</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Range</span>
            {([7, 30, 90] as DateRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDays(range)}
                aria-pressed={days === range}
                className={`min-h-9 rounded-lg px-3 text-sm font-bold transition ${
                  days === range ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {range}d
              </button>
            ))}
          </div>
        </div>

        {stores.length > 1 && (
          <div className="mt-4 overflow-x-auto border-t border-slate-100 pt-4">
            <div className="flex min-w-max gap-2" role="group" aria-label="Filter by store">
              {[{ id: "all", label: "All stores", count: allQuotes.length }, ...stores].map((store) => (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => setStoreFilter(store.id)}
                  aria-pressed={storeFilter === store.id}
                  className={`min-h-9 rounded-full border px-3 text-sm font-bold transition ${
                    storeFilter === store.id
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {store.label}{" "}
                  <span className={storeFilter === store.id ? "text-blue-100" : "text-slate-400"}>{store.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500" aria-live="polite">
          Showing <span className="font-bold text-slate-800">{quotes.length}</span> of {allQuotes.length} orders
          {refreshing && !loading ? " | Refreshing" : ""}
        </p>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-sm font-bold text-blue-700 hover:text-blue-800">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-label="Loading shipping quotes">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="h-5 w-32 rounded bg-slate-200" />
              <div className="mt-4 h-4 w-56 rounded bg-slate-100" />
              <div className="mt-8 h-12 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : quotes.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl font-black text-slate-500">RF</div>
          <h2 className="mt-4 text-lg font-bold text-slate-950">
            {allQuotes.length ? "No quotes match these filters" : "No shipping quotes yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            {allQuotes.length
              ? "Try another store, status, date range, or search term."
              : "Once Freightcom is connected and the ship-from address is complete, new Shopify orders will appear automatically."}
          </p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="mt-5 min-h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">
              Reset filters
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="grid gap-3 lg:hidden">
            {quotes.map((quote) => {
              const key = quoteKey(quote);
              return (
                <QuoteMobileCard
                  key={key}
                  quote={quote}
                  expanded={open === key}
                  busy={busy === key}
                  onToggle={() => setOpen(open === key ? null : key)}
                  onRequote={() => void requote(quote)}
                />
              );
            })}
          </div>

          <section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Order</th>
                    <th scope="col" className="px-4 py-3">Destination</th>
                    <th scope="col" className="px-4 py-3">Method</th>
                    <th scope="col" className="px-4 py-3">Package</th>
                    <th scope="col" className="px-4 py-3">Best option</th>
                    <th scope="col" className="px-4 py-3 text-right">Total</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="w-28 px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => {
                    const key = quoteKey(quote);
                    const pkg = quote.packages?.[0];
                    const destination = quote.destination?.address;
                    const expanded = open === key;
                    const detailsId = `desktop-quote-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                          <td className="px-4 py-4">
                            <p className="font-bold text-slate-950">{quote.order_name}</p>
                            <p className="mt-1 text-xs text-slate-500">{quote.store_label} | {when(quote.order_created_at)}</p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-medium text-slate-800">{quote.customer_name ?? "No customer name"}</p>
                            <p className="mt-1 text-xs text-slate-500">{destination ? `${destination.city}, ${destination.region} ${destination.postal_code}` : "No destination"}</p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{quote.shipping_method ?? "N/A"}</td>
                          <td className="px-4 py-4 text-slate-600">
                            {pkg ? (
                              <>
                                <p>
                                  {quote.packages.length}{" "}
                                  {"freight_class" in pkg
                                    ? `crate${quote.packages.length === 1 ? "" : "s"}`
                                    : `box${quote.packages.length === 1 ? "" : "es"}`}{" "}
                                  × {pkg.measurements.weight.value} lb
                                </p>
                                <p className="mt-1 text-xs text-slate-500">{pkg.measurements.cuboid.l} x {pkg.measurements.cuboid.w} x {pkg.measurements.cuboid.h} in</p>
                                {"freight_class" in pkg && <span className="mt-1 mr-1 inline-block text-xs font-semibold text-slate-500">LTL class {pkg.freight_class}</span>}
                                {quote.weight_source === "default" && <span className="mt-1 inline-block text-xs font-semibold text-amber-700">Default weight</span>}
                              </>
                            ) : "N/A"}
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-slate-900">{quote.cheapest?.carrier ?? "Not quoted"}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {quote.cheapest?.service ?? "N/A"}
                              {quote.cheapest?.transit_days !== null && quote.cheapest?.transit_days !== undefined ? ` | ${quote.cheapest.transit_days}d` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-right font-extrabold tabular-nums text-slate-950">{quote.cheapest ? money(quote.cheapest.total, quote.cheapest.currency) : "N/A"}</td>
                          <td className="px-4 py-4"><StatusPill status={quote.status} /></td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex flex-col items-stretch gap-2">
                              <button
                                type="button"
                                onClick={() => setOpen(expanded ? null : key)}
                                aria-expanded={expanded}
                                aria-controls={detailsId}
                                className="min-h-9 rounded-lg bg-slate-100 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                              >
                                {expanded ? "Hide" : "Rates"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void requote(quote)}
                                disabled={busy !== null}
                                className="min-h-9 rounded-lg border border-slate-300 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {busy === key ? "Quoting..." : "Requote"}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr id={detailsId} className="border-t border-slate-200 bg-slate-50/70">
                            <td colSpan={8} className="p-5">
                              <div className="mb-3 flex items-center justify-between gap-4">
                                <h3 className="font-bold text-slate-950">All rates for {quote.order_name}</h3>
                                <button type="button" onClick={() => setOpen(null)} className="text-sm font-bold text-slate-500 hover:text-slate-800">Close</button>
                              </div>
                              <QuoteDetails quote={quote} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
