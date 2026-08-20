"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/reset-password` }
      );
      // Supabase doesn't reveal whether the email exists — the only real
      // errors here are rate limits, worth showing so people stop retrying.
      if (resetError) {
        setError(resetError.message);
        setLoading(false);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-700">
          If <span className="font-semibold">{email.trim().toLowerCase()}</span> has an
          account, a reset link is on its way. Open the email on this phone and tap the
          link to choose a new password.
        </p>
        <p className="text-xs text-slate-500">
          Nothing after a few minutes? Check your junk folder, or ask a manager to set a
          password for you.
        </p>
        <a
          href="/login"
          className="block min-h-11 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-500">
        Enter your work email and we&apos;ll send you a link to choose a new password.
      </p>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div>
        <label htmlFor="forgot-email" className="mb-1 block text-xs font-medium text-slate-600">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={loading || !email}
        className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send reset link"}
      </button>
      <a
        href="/login"
        className="block py-1 text-center text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
      >
        Back to sign in
      </a>
    </form>
  );
}
