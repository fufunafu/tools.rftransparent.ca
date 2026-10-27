"use client";

import { useEffect } from "react";
import { clientErrorReport } from "@/lib/client-error-reporting";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Route rendering failed", error);
    const report = clientErrorReport(error, window.location.pathname);
    const key = `render-error:${report.path}:${report.name}:${report.digest ?? report.message}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch { /* Reporting must not depend on browser storage. */ }
    void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), keepalive: true }).then((response) => { if (response.ok) try { sessionStorage.setItem(key, "reported"); } catch { /* Optional deduplication. */ } }).catch(() => {});
  }, [error]);

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">This page could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your saved leads are safe. Try again, or reload the page to load the latest version. Your lead filters will be restored.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={unstable_retry}
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} className="ml-3 mt-6 inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm text-slate-700">Reload page</button>
      </div>
    </div>
  );
}
