import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Access Denied | RF Tools",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">You do not have access to this page</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          This area is limited to a specific role. Ask a manager or administrator if your responsibilities require access.
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
