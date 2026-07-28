"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NotificationSettings } from "@/lib/settings";

interface Store {
  id: string;
  label: string;
}

const INPUT_CLASS =
  "w-full px-3 py-2 text-sm rounded-lg border border-sand-200 focus:border-accent focus:outline-none disabled:bg-sand-50 disabled:text-sand-500";

/** A growable list of email addresses. */
function EmailList({
  values,
  onChange,
  disabled,
  addLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  addLabel: string;
}) {
  return (
    <div className="space-y-2 max-w-md">
      {values.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="email"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(values.map((v, idx) => (idx === i ? e.target.value : v)))}
            placeholder="name@example.com"
            aria-label={`Recipient ${i + 1}`}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            disabled={disabled || values.length === 1}
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
            aria-label={`Remove ${value || "recipient"}`}
            title={values.length === 1 ? "Keep at least one address" : "Remove"}
            className="shrink-0 w-8 h-8 rounded-lg text-sand-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-sand-400"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 mx-auto">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
        className="text-xs font-medium text-accent hover:underline disabled:text-sand-400 disabled:no-underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

function Section({
  title,
  schedule,
  help,
  children,
}: {
  title: string;
  schedule: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-sand-900">{title}</h3>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-sand-100 text-sand-500">{schedule}</span>
        </div>
        <p className="text-xs text-sand-500 mt-1">{help}</p>
      </div>
      {children}
    </div>
  );
}

export default function NotificationsForm({
  initial,
  stores,
  canEdit,
}: {
  initial: NotificationSettings;
  stores: Store[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [cronAlerts, setCronAlerts] = useState<string[]>(initial.cron_alerts);
  const [digest, setDigest] = useState<string[]>(
    initial.problems_digest.length ? initial.problems_digest : [""]
  );
  const [byStore, setByStore] = useState<Record<string, string>>(initial.followup_by_store);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cron_alerts: cronAlerts,
          problems_digest: digest,
          followup_by_store: byStore,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;

  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-sand-900">Notifications</h2>
        <p className="text-sm text-sand-500 mt-1">
          Who receives each automated email. Changes take effect on the next send — no deploy needed.
        </p>
      </div>

      {!canEdit && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          You can see these settings but not change them. Ask an admin to edit them.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          Saved.
        </div>
      )}

      <Section
        title="Failure alerts"
        schedule="when a job breaks"
        help="Sent the moment a scheduled job errors out. Keep at least one address here — this is the only warning you get that a sync stopped working."
      >
        <EmailList
          values={cronAlerts}
          onChange={setCronAlerts}
          disabled={disabled}
          addLabel="+ Add another address"
        />
      </Section>

      <Section
        title="Problem ticket digest"
        schedule="Mondays, 9am"
        help="The week's open problem tickets with names and ages, so stale ones can't quietly rot."
      >
        <EmailList
          values={digest}
          onChange={setDigest}
          disabled={disabled}
          addLabel="+ Add another address"
        />
      </Section>

      <Section
        title="Follow-up reminders"
        schedule="weekdays, 9am"
        help="Leads due or overdue for a follow-up, one email per store. Leave a box empty to stop that store's reminder."
      >
        <div className="space-y-3 max-w-md">
          {stores.map((store) => (
            <div key={store.id}>
              <label className="text-xs font-medium text-sand-700 block mb-1" htmlFor={`store-${store.id}`}>
                {store.label}
              </label>
              <input
                id={`store-${store.id}`}
                type="email"
                value={byStore[store.id] ?? ""}
                disabled={disabled}
                onChange={(e) => setByStore({ ...byStore, [store.id]: e.target.value })}
                placeholder="name@example.com"
                className={INPUT_CLASS}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Employee surveys"
        schedule="Fridays, 10am"
        help="Each active employee gets their own survey link, so there's no recipient list to set. Manage who's active under Settings → Employees."
      >
        <p className="text-sm text-sand-400">Sent to every active employee.</p>
      </Section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
