"use client";

import { useState, useSyncExternalStore } from "react";
import { createBrowserClient } from "@supabase/ssr";
import {
  clearLegacySavedCredentials,
  isNativeApp,
  markNativeSessionFresh,
} from "@/lib/app-biometrics";

// Whether we're inside the iOS app never changes during a page's life; the
// server snapshot is false so SSR and hydration agree, and the real value
// arrives with the first client render.
const NEVER_CHANGES = () => () => {};
const serverSaysNo = () => false;

export default function LoginForm({
  authError,
  nextPath = "/",
  testLogin = false,
}: {
  authError?: string;
  nextPath?: string;
  // The server only enables this for an explicitly configured local test run.
  testLogin?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(authError ?? "");

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Google OAuth is blocked in embedded web views, so the iOS app uses the
  // password form. Once signed in, the persisted session is protected by the
  // app-level Face ID or device-passcode gate.
  const inApp = useSyncExternalStore(NEVER_CHANGES, isNativeApp, serverSaysNo);
  const passwordFormVisible = showPassword || inApp;

  const supabase = () =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const { error: oauthError } = await supabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
      // On success the browser is redirected to Google — no further action needed.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  const signInWithPassword = async (loginEmail: string, loginPassword: string): Promise<boolean> => {
    const { error: signInError } = await supabase().auth.signInWithPassword({
      email: loginEmail.trim().toLowerCase(),
      password: loginPassword,
    });
    return !signInError;
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (!(await signInWithPassword(email, password))) {
        setError("Wrong email or password.");
        setLoading(false);
        return;
      }
      if (inApp) {
        await clearLegacySavedCredentials();
        markNativeSessionFresh();
      }
      // Full reload so the proxy re-runs and lands them on the home page.
      window.location.href = nextPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/dev-login", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Dev login failed");
        setLoading(false);
        return;
      }
      const { error: verifyError } = await supabase().auth.verifyOtp({
        type: "magiclink",
        token_hash: body.tokenHash,
      });
      if (verifyError) {
        setError(verifyError.message);
        setLoading(false);
        return;
      }
      if (inApp) {
        await clearLegacySavedCredentials();
        markNativeSessionFresh();
      }
      window.location.href = nextPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Google cannot run inside the app's embedded web view. */}
      {!inApp && (
        <>
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50 hover:shadow-md disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {loading ? "Redirecting..." : "Sign in with Google"}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-600 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        </>
      )}

      {!passwordFormVisible ? (
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          disabled={loading}
          className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          Sign in with email and password
        </button>
      ) : (
        <form onSubmit={handlePasswordLogin} className="space-y-3">
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-slate-600 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-slate-600 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="min-h-11 w-full rounded-xl bg-blue-600 text-white text-sm font-bold px-6 py-3 hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <a
            href="/forgot-password"
            className="block py-1 text-center text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
          >
            Forgot your password?
          </a>
          <p className="text-xs text-slate-600 text-center">
            Don&apos;t have a password? Ask a manager to set one up for you.
          </p>
        </form>
      )}

      {testLogin && (
        <button
          type="button"
          onClick={handleDevLogin}
          disabled={loading}
          className="w-full rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 px-6 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in as Fuanne"}
        </button>
      )}
    </div>
  );
}
