"use client";

import { useEffect, useState } from "react";
import {
  ACCESS_STATUS_LABELS,
  LOGIN_METHOD_LABELS,
  type AccessStatus,
  type LoginMethod,
} from "@/lib/access-templates";

interface AccessRow {
  id: string;
  system: string;
  login_method: LoginMethod;
  account_id: string | null;
  owner_email: string | null;
  status: AccessStatus;
  note: string | null;
}

const STATUS_CLS: Record<AccessStatus, string> = {
  not_requested: "border-slate-200 bg-slate-50 text-slate-600",
  requested: "border-amber-200 bg-amber-50 text-amber-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  revoked: "border-slate-200 bg-slate-100 text-slate-500",
};

// Google gets its own colour for the same reason the onboarding form gives it
// one: "which of these do I open with my Google account" is the question
// people actually arrive with.
function methodBadge(method: LoginMethod) {
  const cls =
    method === "google_sso"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : method === "none"
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : "border-violet-200 bg-violet-50 text-violet-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {LOGIN_METHOD_LABELS[method]}
    </span>
  );
}

export default function MyAccessList() {
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/employees/access", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load your access list");
        setRows(data.access ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your access list"));
  }, []);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">My access</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">What you can sign in to</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
          Every system set up for you, how you sign in to it, and who to ask when something
          does not work. Ask the person named beside a system — this page cannot change it.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {rows === null && !error && (
        <p className="text-sm text-slate-500">Loading…</p>
      )}

      {rows?.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-600">Nothing is listed for you yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Ask your manager if you are waiting on an account.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-950">{row.system}</span>
                  {methodBadge(row.login_method)}
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[row.status]}`}>
                  {ACCESS_STATUS_LABELS[row.status]}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-slate-400">Username</dt>
                  <dd className="text-slate-700">{row.account_id?.trim() || "Your work email"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-400">Ask</dt>
                  <dd className="text-slate-700">{row.owner_email?.trim() || "Your manager"}</dd>
                </div>
              </dl>
              {row.note && <p className="mt-3 text-xs leading-5 text-slate-500">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
