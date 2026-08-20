"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { passwordProblem, recoveryParams } from "@/lib/password-reset";

// Reached from the reset email. The templated link carries a token_hash that
// works in whatever browser it opens in; the default-template fallback
// carries a PKCE code that only works in the browser that asked for the
// reset. A signed-in visitor with neither can simply change their password.
type Step = "verifying" | "ready" | "invalid" | "done";

export default function ResetPasswordForm() {
  const [step, setStep] = useState<Step>("verifying");
  // A recovery link signs the visitor in as a side effect; remember that so
  // we can sign the browser back out once the new password is saved.
  const cameFromEmail = useRef(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const supabase = () =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { tokenHash, code } = recoveryParams(window.location.search);
      // Recovery links are single-use; drop them from the URL so a refresh
      // doesn't retry a consumed token and scare people with an error.
      if (tokenHash || code) {
        cameFromEmail.current = true;
        window.history.replaceState(null, "", "/reset-password");
      }
      try {
        if (tokenHash) {
          const { error: verifyError } = await supabase().auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash,
          });
          if (!cancelled) setStep(verifyError ? "invalid" : "ready");
          return;
        }
        if (code) {
          const { error: codeError } = await supabase().auth.exchangeCodeForSession(code);
          if (!cancelled) setStep(codeError ? "invalid" : "ready");
          return;
        }
        const { data } = await supabase().auth.getUser();
        if (!cancelled) setStep(data.user ? "ready" : "invalid");
      } catch {
        if (!cancelled) setStep("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const client = supabase();
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
      // Don't leave a signed-in session lying around in the email browser —
      // the person is heading back to the app to sign in there.
      if (cameFromEmail.current) await client.auth.signOut();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSaving(false);
    }
  };

  if (step === "verifying") {
    return <p className="text-center text-sm text-slate-500">Checking your reset link…</p>;
  }

  if (step === "invalid") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-700">
          This reset link has expired or was already used.
        </p>
        <a
          href="/forgot-password"
          className="block min-h-11 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          Send me a new link
        </a>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-700">
          Your password is updated. Open the RF Tools app and sign in with it.
        </p>
        <a
          href="/login"
          className="block min-h-11 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div>
        <label htmlFor="new-password" className="mb-1 block text-xs font-medium text-slate-600">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={saving}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-1 block text-xs font-medium text-slate-600">
          Type it again
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          disabled={saving}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={saving || !password || !confirm}
        className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
