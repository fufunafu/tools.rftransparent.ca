"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const MIN_LENGTH = 8;

export default function AccountForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      setPassword("");
      setConfirm("");
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-sand-900">My Account</h2>
        <p className="text-sm text-sand-500 mt-1">
          Your own sign-in details. To manage other people&apos;s access, use Settings → Employees.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {savedAt && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          Password changed. It takes effect the next time you sign in.
        </div>
      )}

      <div className="bg-white rounded-xl border border-sand-200/60 p-6 space-y-5">
        <div>
          <div className="text-sm font-medium text-sand-900 mb-1">Signed in as</div>
          <p className="text-sm text-sand-600">{email}</p>
        </div>

        <div>
          <div className="text-sm font-medium text-sand-900 mb-1">New password</div>
          <p className="text-xs text-sand-500 mb-2">
            At least {MIN_LENGTH} characters. If you normally sign in with Google, setting a
            password here adds a second way in — it doesn&apos;t replace Google.
          </p>
          <div className="space-y-2 max-w-sm">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="New password"
              aria-label="New password"
              className="w-full px-3 py-2 text-sm rounded-lg border border-sand-200 focus:border-accent focus:outline-none"
            />
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirm new password"
              aria-label="Confirm new password"
              className="w-full px-3 py-2 text-sm rounded-lg border border-sand-200 focus:border-accent focus:outline-none"
            />
            <label className="flex items-center gap-2 text-xs text-sand-500">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Show passwords
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !password || !confirm}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:bg-sand-300 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
