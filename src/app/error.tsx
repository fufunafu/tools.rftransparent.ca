"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Route rendering failed", error);
  }, [error]);

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">This page could not be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The problem may be temporary. Try loading the page again.
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
      </div>
    </div>
  );
}
