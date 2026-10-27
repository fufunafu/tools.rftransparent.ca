// Home-specific skeleton: mirrors the OpsDashboard shell (header, sales card,
// two-up middle row, three-up performers, collection strip) so navigation to /
// paints instantly instead of blocking on the force-dynamic data fetch. Other
// routes keep the generic fallback in src/app/loading.tsx.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <div className="mx-auto max-w-md space-y-5 md:hidden">
        <div className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-4 w-44 animate-pulse rounded-lg bg-slate-200/80" />
        </div>
        <div className="h-20 animate-pulse rounded-2xl bg-blue-100" />
        <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-24 animate-pulse border-l border-slate-100 first:border-l-0" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      </div>

      <div className="mx-auto hidden max-w-[1184px] space-y-3 md:block">
        <div className="space-y-2">
          <div className="h-7 w-44 animate-pulse rounded-md bg-slate-200" />
          <div className="h-4 w-64 animate-pulse rounded bg-slate-200/80" />
        </div>
        <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="grid grid-cols-2 items-start gap-3">
          <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>

      <span className="sr-only">Loading dashboard content</span>
    </div>
  );
}
