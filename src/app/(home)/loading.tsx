// Home-specific skeleton: mirrors the OpsDashboard shell (header, sales card,
// two-up middle row, three-up performers, collection strip) so navigation to /
// paints instantly instead of blocking on the force-dynamic data fetch. Other
// routes keep the generic fallback in src/app/loading.tsx.
export default function Loading() {
  return (
    <div className="max-w-[1184px] mx-auto space-y-3" role="status" aria-label="Loading dashboard">
      <div className="space-y-2">
        <div className="h-7 w-44 rounded-md bg-slate-200 animate-pulse" />
        <div className="h-4 w-64 rounded bg-slate-200/80 animate-pulse" />
      </div>
      <div className="h-56 rounded-xl border border-slate-200 bg-white animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        <div className="h-48 rounded-xl border border-slate-200 bg-white animate-pulse" />
        <div className="h-48 rounded-xl border border-slate-200 bg-white animate-pulse" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-40 rounded-xl border border-slate-200 bg-white animate-pulse" />
        ))}
      </div>
      <div className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse" />
      <span className="sr-only">Loading dashboard content</span>
    </div>
  );
}
