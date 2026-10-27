import Link from "next/link";

export default function PublicInfoLayout({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-blue-800 bg-gradient-to-br from-blue-900 to-blue-950 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/login" className="flex min-h-11 items-center gap-3 rounded-xl pr-3 font-semibold">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-sm font-extrabold shadow-lg shadow-blue-950/30">
              RF
            </span>
            <span>RF Transparent Tools</span>
          </Link>
          <Link href="/login" className="flex min-h-11 items-center rounded-xl border border-white/25 px-4 text-sm font-bold hover:bg-white/10">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{intro}</p>
        <div className="mt-10 space-y-9 text-[15px] leading-7 text-slate-700">{children}</div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-5 py-7 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 15041074 Canada Inc.</p>
          <nav aria-label="Legal and support" className="flex gap-5">
            <Link href="/privacy" className="font-semibold text-blue-700 hover:text-blue-800">Privacy</Link>
            <Link href="/support" className="font-semibold text-blue-700 hover:text-blue-800">Support</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
