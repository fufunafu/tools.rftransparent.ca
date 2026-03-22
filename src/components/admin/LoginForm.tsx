"use client";

import { useState } from "react";
export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        switch (data.code) {
          case "MISSING_PASSWORD":
            setError("Please enter a password.");
            break;
          case "NOT_CONFIGURED":
            setError(
              "Admin password is not configured on the server. Please check your environment variables."
            );
            break;
          case "INVALID_PASSWORD":
            setError("Incorrect password. Please try again.");
            break;
          default:
            setError(
              `Login failed (${res.status}). ${data.error || "Please try again."}`
            );
        }
        setLoading(false);
        return;
      }

      window.location.href = "/";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      setError(
        `Network error: could not reach the server. ${message}`
      );
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="admin-password"
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Enter password"
          autoFocus
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-3"
          role="alert"
        >
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password.trim()}
        className="w-full rounded-xl bg-blue-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-60"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
