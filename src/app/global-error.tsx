"use client";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900">
        <main className="min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
            <title>Application Error | RF Tools</title>
            <h1 className="text-xl font-semibold">RF Tools could not start</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Reload the application. If the problem continues, report the reference below.
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>
            )}
            <button
              type="button"
              onClick={unstable_retry}
              className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Reload application
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
