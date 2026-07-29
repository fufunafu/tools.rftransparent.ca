"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accessReasons, type AccessOverview } from "@/lib/access";

function lastSeen(iso: string | null): string {
  if (!iso) return "never signed in";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "signed in today";
  if (days === 1) return "signed in yesterday";
  if (days < 30) return `signed in ${days} days ago`;
  const months = Math.round(days / 30);
  return `signed in ${months} month${months === 1 ? "" : "s"} ago`;
}

function Card({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-sand-900">{title}</h3>
        <p className="text-xs text-sand-500 mt-1">{help}</p>
      </div>
      {children}
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "That didn't work");
      setOverview(data as AccessOverview);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (await send("/api/settings/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail }),
    })) {
      setNewEmail("");
    }
  }

  async function removeAdmin(email: string) {
    setRemoving(null);
    await send(`/api/settings/access?email=${encodeURIComponent(email)}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-sand-900">Who Can Sign In</h2>
        <p className="text-sm text-sand-500 mt-1">
          Access comes from four separate places. Someone can hold more than one, so removing them
          from one list doesn&apos;t always lock them out.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <Card title="Owner" help="Set in code. Always has full access and can't be removed here.">
        <p className="text-sm text-sand-700">{overview.owner}</p>
      </Card>

      <Card
        title="Allowed email domains"
        help="Anyone with an address at these domains can sign in and is treated as an admin. Set by the ADMIN_ALLOWED_DOMAINS environment variable, so changing it takes a redeploy."
      >
        {overview.domains.length === 0 ? (
          <p className="text-sm text-sand-400">None — nobody gets in by domain.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {overview.domains.map((domain) => (
              <li key={domain} className="text-xs px-2 py-1 rounded-lg bg-sand-100 text-sand-700">
                @{domain}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Manual admins"
        help="One-off admin access for someone who isn't an employee and isn't on an allowed domain. This is the only list on this page you can edit."
      >
        {overview.adminsUnavailable ? (
          <p className="text-sm text-amber-700">
            The admin_users table doesn&apos;t exist, so there are no manual admins. Adding one here
            will fail until it&apos;s created.
          </p>
        ) : overview.admins.length === 0 ? (
          <p className="text-sm text-sand-400">Nobody.</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {overview.admins.map((admin) => (
              <li key={admin.email} className="py-2 flex items-center gap-3">
                <span className="text-sm text-sand-800 flex-1 truncate">{admin.email}</span>
                {admin.email.toLowerCase() === currentUser.toLowerCase() && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-sand-100 text-sand-500">you</span>
                )}
                {removing === admin.email ? (
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-amber-700">
                      {admin.email.toLowerCase() === currentUser.toLowerCase()
                        ? "Remove your own admin access?"
                        : "Remove?"}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeAdmin(admin.email)}
                      className="text-[11px] font-medium px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="text-[11px] font-medium px-2 py-1 rounded-lg text-sand-600 hover:bg-sand-100"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRemoving(admin.email)}
                    className="text-[11px] font-medium text-sand-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addAdmin} className="flex items-center gap-2 pt-1">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Email to grant admin access"
            className="flex-1 max-w-xs px-3 py-2 text-sm rounded-lg border border-sand-200 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !newEmail.trim()}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed"
          >
            Add admin
          </button>
        </form>
      </Card>

      <Card
        title="Active employees"
        help="Every active employee with an email address can sign in — they're not admins, so they see the data but can't change settings. Deactivating someone on the Employees page removes this route in."
      >
        {overview.employees.length === 0 ? (
          <p className="text-sm text-sand-400">No active employees have an email address on file.</p>
        ) : (
          <>
            <p className="text-sm text-sand-700">
              {overview.employees.length} active employee
              {overview.employees.length === 1 ? "" : "s"} can sign in.
            </p>
            <Link href="/employees" className="inline-block text-xs font-medium text-accent hover:underline">
              Manage on the Employees page →
            </Link>
          </>
        )}
      </Card>

      <Card
        title="Accounts that exist"
        help="Sign-in accounts that have actually been created, and when each was last used. An account here with no route in above can no longer sign in."
      >
        {overview.accountsUnavailable ? (
          <p className="text-sm text-sand-400">Couldn&apos;t read the account list.</p>
        ) : overview.accounts.length === 0 ? (
          <p className="text-sm text-sand-400">No accounts yet.</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {overview.accounts.map((account) => {
              const reasons = accessReasons(account.email, overview);
              return (
                <li key={account.email} className="py-2 flex items-baseline gap-3 flex-wrap">
                  <span className="text-sm text-sand-800 flex-1 min-w-0 truncate">{account.email}</span>
                  <span className="text-xs text-sand-400">{lastSeen(account.last_sign_in_at)}</span>
                  {reasons.length === 0 ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                      no longer has access
                    </span>
                  ) : (
                    <span className="text-[11px] text-sand-400">{reasons.join(" · ")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
