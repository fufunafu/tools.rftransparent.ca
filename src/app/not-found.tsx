import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">404</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The link may be outdated or the page may have moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
