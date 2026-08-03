export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" role="status" aria-label="Loading page">
      <div className="space-y-2">
        <div className="h-7 w-44 rounded-md bg-slate-200 animate-pulse" />
        <div className="h-4 w-64 rounded bg-slate-200/80 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse" />
        ))}
      </div>
      <div className="h-72 rounded-xl border border-slate-200 bg-white animate-pulse" />
      <span className="sr-only">Loading page content</span>
    </div>
  );
}
