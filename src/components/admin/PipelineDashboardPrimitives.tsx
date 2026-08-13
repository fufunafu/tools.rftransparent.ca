"use client";

import { useState, type ReactNode } from "react";

export const formatMoney = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(2)}M`
    : value >= 1_000
      ? `$${(value / 1_000).toFixed(2)}K`
      : `$${value.toFixed(2)}`;

export const formatMoneyFull = (value: number) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const formatPercent = (value: number) => `${value}%`;

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

const metricToneClasses = {
  slate: "border-slate-200 text-slate-900",
  blue: "border-blue-200 text-blue-700",
  green: "border-green-200 text-green-700",
  amber: "border-amber-200 text-amber-700",
  purple: "border-purple-200 text-purple-700",
} as const;

export function MetricCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: keyof typeof metricToneClasses;
}) {
  return (
    <div className={`border-t-2 bg-white px-4 py-4 shadow-sm ${metricToneClasses[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-current">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "slate" | "blue" | "green" | "amber" | "red";
  children: ReactNode;
}) {
  const classes = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-800",
    red: "bg-red-50 text-red-700",
  }[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${classes}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
        className="rounded-full text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <span className="absolute right-0 top-6 z-30 w-64 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

export function EmptySection({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
