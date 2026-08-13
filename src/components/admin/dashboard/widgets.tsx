"use client";

import Link from "next/link";

// Shared building blocks for the role dashboards and the owner dashboard.
// Moved verbatim from OpsDashboard.tsx — keep markup identical so every
// consumer renders the same.

// ─── Formatting ──────────────────────────────────────────────────────────────

export function pct(n: number | null | undefined, digits = 1): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(digits)}%` : "—";
}

export function num(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
}

export function delta(current: number, previous: number | null): { text: string; tone: string } | null {
  if (previous === null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change)) return null;
  return {
    text: `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`,
    tone: change >= 0 ? "text-emerald-600" : "text-red-600",
  };
}

/** Lower-is-better metrics invert: under target is good. */
export function toneAgainstTarget(value: number | null, target: number, lowerIsBetter: boolean): string {
  if (value === null) return "text-slate-900";
  const good = lowerIsBetter ? value <= target : value >= target;
  const near = lowerIsBetter ? value <= target * 1.25 : value >= target * 0.9;
  return good ? "text-emerald-600" : near ? "text-amber-600" : "text-red-600";
}

// ─── Small pieces ────────────────────────────────────────────────────────────

export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span className="flex items-end gap-px h-[22px]" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-[4px] rounded-[1px] ${i === values.length - 1 ? "bg-blue-500" : "bg-slate-200"}`}
          style={{ height: `${Math.max(2, (v / max) * 22)}px` }}
        />
      ))}
    </span>
  );
}

export function Unavailable({ label, error }: { label: string; error: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-soft p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm text-slate-400">Unavailable</p>
      <p className="mt-0.5 text-xs text-slate-400 leading-snug">{error}</p>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  href,
  tone = "text-slate-900",
  amber = false,
  dataLabel,
  calc,
  src,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: string;
  amber?: boolean;
  dataLabel: string;
  calc: string;
  src: string;
}) {
  const body = (
    <div
      className={`h-full px-4 py-2.5 ${amber ? "bg-amber-50" : "bg-white"}`}
      data-label={dataLabel}
      data-calc={calc}
      data-src={src}
    >
      <p className="text-[10.5px] text-slate-400">{label}</p>
      <p className={`text-[21px] font-semibold tabular-nums leading-tight ${amber ? "text-amber-700" : tone}`}>
        {value}
      </p>
      {sub ? <p className="text-[11px] text-slate-500 leading-tight">{sub}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full hover:bg-slate-50 transition-colors">
      {body}
    </Link>
  ) : (
    body
  );
}

export function CardShell({
  label,
  note,
  footer,
  children,
}: {
  label: string;
  note?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-4 py-[7px] border-b border-slate-100">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
        {note && <span className="text-[11px] text-slate-400">{note}</span>}
      </div>
      <div className="grid grid-cols-3 gap-px bg-slate-100">{children}</div>
      {footer && (
        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-100 text-[12px]">
          {footer}
        </div>
      )}
    </section>
  );
}
