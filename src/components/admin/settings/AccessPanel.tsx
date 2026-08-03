"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accessReasons, type AccessOverview } from "@/lib/access";

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function ShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75c2.05 1.4 4.35 2.13 6.75 2.25v5.25c0 4.4-2.63 7.7-6.75 9-4.12-1.3-6.75-4.6-6.75-9V6C7.65 5.88 9.95 5.15 12 3.75Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 12 1.7 1.7 3.65-3.65" />
    </svg>
  );
}

function UsersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18.75a6 6 0 0 0-12 0" />
      <circle cx="9" cy="8.25" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6.25a2.5 2.5 0 0 1 0 5M18 18.25a4.5 4.5 0 0 0-3.5-4.38" />
    </svg>
  );
}

function KeyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <circle cx="8.5" cy="12" r="4.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 12H21m-3 0v3m-3-3v2" />
    </svg>
  );
}

function GlobeIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path strokeLinecap="round" d="M3.75 12h16.5M12 3.5c2.05 2.3 3.1 5.13 3.1 8.5S14.05 18.2 12 20.5C9.95 18.2 8.9 15.37 8.9 12S9.95 5.8 12 3.5Z" />
    </svg>
  );
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="10.75" cy="10.75" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4 4" />
    </svg>
  );
}

function ArrowUpRightIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="border-t border-slate-200/80 px-5 py-4 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "blue" | "green" | "amber" | "slate"; children: ReactNode }) {
  const classes = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes}`}>
      {children}
    </span>
  );
}

function emailInitials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const pieces = name.split(/[._-]+/).filter(Boolean);
  if (pieces.length > 1) return `${pieces[0][0]}${pieces[1][0]}`.toUpperCase();
  return (pieces[0]?.slice(0, 2) || "?").toUpperCase();
}

function accountLastSeen(iso: string | null): { short: string; full: string } {
  if (!iso) return { short: "Never", full: "This account has never signed in" };

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { short: "Unknown", full: "Last sign-in is unavailable" };

  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  const full = new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(date);

  if (days === 0) return { short: "Today", full };
  if (days === 1) return { short: "Yesterday", full };
  if (days < 30) return { short: `${days} days ago`, full };
  const months = Math.round(days / 30);
  if (months < 12) return { short: `${months} mo ago`, full };
  const years = Math.round(days / 365);
  return { short: `${years} yr ago`, full };
}

function providerLabel(providers: string[]): string {
  const labels = providers.map((provider) => {
    if (provider === "google") return "Google";
    if (provider === "email") return "Password";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  });
  return labels.length > 0 ? labels.join(" + ") : "Account";
}

export default function AccessPanel({
  initial,
  currentUser,
}: {
  initial: AccessOverview;
  currentUser: string;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [newEmail, setNewEmail] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const accountsNeedingReview = useMemo(
    () => overview.accounts.filter((account) => accessReasons(account.email, overview).length === 0),
    [overview],
  );
  const filteredAccounts = useMemo(() => {
    const query = accountQuery.trim().toLowerCase();
    if (!query) return overview.accounts;
    return overview.accounts.filter((account) => {
      const reasons = accessReasons(account.email, overview).join(" ").toLowerCase();
      return account.email.toLowerCase().includes(query) || reasons.includes(query);
    });
  }, [accountQuery, overview]);

  async function send(url: string, init: RequestInit, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That did not work");
      setOverview(data as AccessOverview);
      setNotice(successMessage);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (
      await send(
        "/api/settings/access",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
        `${email} now has admin access.`,
      )
    ) {
      setNewEmail("");
    }
  }

  async function removeAdmin(email: string) {
    setRemoving(null);
    await send(
      `/api/settings/access?email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
      `${email} was removed from manual admins.`,
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <div className="absolute right-0 top-0 h-44 w-44 translate-x-12 -translate-y-14 rounded-full bg-blue-100/60 blur-2xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-blue-600">
                <ShieldIcon className="h-4 w-4" />
                Access control
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
                Who can sign in
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Review every route into RF Tools. People may qualify through more than one rule, so removing one route might not remove their access.
              </p>
            </div>
            {overview.accountsUnavailable ? (
              <StatusPill tone="slate">Account review unavailable</StatusPill>
            ) : accountsNeedingReview.length > 0 ? (
              <StatusPill tone="amber">
                {accountsNeedingReview.length} account{accountsNeedingReview.length === 1 ? "" : "s"} to review
              </StatusPill>
            ) : (
              <StatusPill tone="green">All accounts have a valid route</StatusPill>
            )}
          </div>
        </div>

        <div className="grid border-slate-200 bg-slate-50/70 sm:grid-cols-4 sm:border-t">
          <Metric label="Manual admins" value={overview.admins.length} note="Editable here" />
          <Metric label="Allowed domains" value={overview.domains.length} note="Set in deployment" />
          <Metric label="Active employees" value={overview.employees.length} note="Standard access" />
          <Metric
            label="Created accounts"
            value={overview.accountsUnavailable ? "–" : overview.accounts.length}
            note="In authentication"
          />
        </div>
      </section>

      <div className="space-y-3" aria-live="polite">
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            {notice}
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
        <Panel>
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <SectionHeading
              icon={<KeyIcon />}
              title="Administrator access"
              description="Admins can view company data and change protected settings."
            />
          </div>

          <div className="divide-y divide-slate-100">
            <div className="p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">Owner</h3>
                    <StatusPill tone="slate">Permanent</StatusPill>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    The owner is set in code and always has full access.
                  </p>
                </div>
                <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  {overview.owner}
                </p>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <GlobeIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">Allowed email domains</h3>
                    <StatusPill tone="slate">Requires redeploy</StatusPill>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Anyone using one of these domains receives administrator access.
                  </p>
                  {overview.domains.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-400">No domains are allowed.</p>
                  ) : (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Allowed email domains">
                      {overview.domains.map((domain) => (
                        <li key={domain} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs font-medium text-slate-700">
                          @{domain}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Manual admins</h3>
                  <p className="mt-1 max-w-lg text-xs leading-5 text-slate-500">
                    Grant one person admin access without changing employee or domain rules.
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {overview.admins.length} {overview.admins.length === 1 ? "person" : "people"}
                </span>
              </div>

              {overview.adminsUnavailable ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-800">
                  Manual admins are unavailable because the admin users table has not been created.
                </div>
              ) : overview.admins.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
                  <p className="text-sm font-medium text-slate-600">No manual admins</p>
                  <p className="mt-1 text-xs text-slate-400">Add an email below when someone needs an exception.</p>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Manual administrators">
                  {overview.admins.map((admin) => {
                    const isCurrentUser = admin.email.toLowerCase() === currentUser.toLowerCase();
                    const isRemoving = removing === admin.email;
                    return (
                      <li key={admin.email} className="px-3.5 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700" aria-hidden="true">
                            {emailInitials(admin.email)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{admin.email}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Manual admin{isCurrentUser ? " · Your account" : ""}
                            </p>
                          </div>
                          {!isRemoving && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setRemoving(admin.email)}
                              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {isRemoving && (
                          <div className="mt-3 flex flex-col gap-3 rounded-lg bg-amber-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-amber-800">
                              {isCurrentUser ? "Remove your own manual admin access?" : `Remove ${admin.email}?`}
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setRemoving(null)}
                                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-white"
                              >
                                Keep access
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => removeAdmin(admin.email)}
                                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                              >
                                {busy ? "Removing..." : "Remove access"}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <form onSubmit={addAdmin} className="mt-4 rounded-xl bg-slate-50 p-3.5 sm:p-4">
                <label htmlFor="new-admin-email" className="text-xs font-semibold text-slate-700">
                  Add a manual admin
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="new-admin-email"
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    className={inputClass}
                  />
                  <button
                    type="submit"
                    disabled={busy || !newEmail.trim() || overview.adminsUnavailable}
                    className="h-11 shrink-0 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {busy ? "Saving..." : "Grant admin access"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionHeading
            icon={<UsersIcon />}
            title="Employee access"
            description="Active employees can view data but cannot change protected settings."
          />

          <div className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
            <p className="text-4xl font-semibold tracking-tight">{overview.employees.length}</p>
            <p className="mt-1 text-sm font-medium text-slate-200">
              active employee{overview.employees.length === 1 ? "" : "s"} with access
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Access follows employee status and requires an email address on file.
            </p>
          </div>

          <div className="mt-5 space-y-3 text-xs leading-5 text-slate-500">
            <div className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              Active employees are admitted automatically.
            </div>
            <div className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
              Deactivating an employee removes this access route.
            </div>
            <div className="flex gap-2.5">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
              Other admin rules may still grant access.
            </div>
          </div>

          <Link
            href="/employees"
            className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Manage employees
            <ArrowUpRightIcon />
          </Link>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <SectionHeading
            icon={<ShieldIcon />}
            title="Account directory"
            description="Created sign-in accounts, their current access route, and recent activity."
          />
          {!overview.accountsUnavailable && overview.accounts.length > 0 && (
            <div className="relative w-full sm:w-64">
              <label htmlFor="account-search" className="sr-only">Search accounts</label>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="account-search"
                type="search"
                value={accountQuery}
                onChange={(event) => setAccountQuery(event.target.value)}
                placeholder="Search accounts"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              />
            </div>
          )}
        </div>

        {overview.accountsUnavailable ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-600">The account directory is unavailable</p>
            <p className="mt-1 text-xs text-slate-400">Access rules above are still current.</p>
          </div>
        ) : overview.accounts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-600">No accounts have been created</p>
            <p className="mt-1 text-xs text-slate-400">Accounts appear after their first invitation or sign-in.</p>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-600">No accounts match “{accountQuery}”</p>
            <button type="button" onClick={() => setAccountQuery("")} className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700">
              Clear search
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  <th scope="col" className="px-5 py-3 sm:px-6">Account</th>
                  <th scope="col" className="px-4 py-3">Access route</th>
                  <th scope="col" className="px-4 py-3">Sign-in method</th>
                  <th scope="col" className="px-5 py-3 text-right sm:px-6">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((account) => {
                  const reasons = accessReasons(account.email, overview);
                  const seen = accountLastSeen(account.last_sign_in_at);
                  const needsReview = reasons.length === 0;
                  return (
                    <tr key={account.email} className={needsReview ? "bg-amber-50/35" : "hover:bg-slate-50/60"}>
                      <td className="px-5 py-3.5 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${needsReview ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`} aria-hidden="true">
                            {emailInitials(account.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-[260px] truncate text-sm font-medium text-slate-800">{account.email}</p>
                            {account.email.toLowerCase() === currentUser.toLowerCase() && (
                              <p className="mt-0.5 text-[11px] text-slate-400">Your account</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {needsReview ? (
                          <StatusPill tone="amber">No current access</StatusPill>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1.5">
                            {reasons.map((reason) => (
                              <StatusPill key={reason} tone={reason === "Owner" || reason === "Manual admin" ? "blue" : "slate"}>
                                {reason}
                              </StatusPill>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">{providerLabel(account.providers)}</td>
                      <td className="px-5 py-3.5 text-right sm:px-6">
                        <span title={seen.full} className={account.last_sign_in_at ? "text-xs text-slate-500" : "text-xs text-slate-400"}>
                          {seen.short}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!overview.accountsUnavailable && overview.accounts.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>
              Showing {filteredAccounts.length} of {overview.accounts.length} accounts
            </span>
            <span>“No current access” means the account exists but cannot sign in.</span>
          </div>
        )}
      </Panel>
    </div>
  );
}
