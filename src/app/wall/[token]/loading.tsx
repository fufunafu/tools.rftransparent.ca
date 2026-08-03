// Wall-board skeleton. Must be dark: the generic white fallback would flash
// blinding white on the office TV between refreshes at night. A fluid grid is
// fine here — no need to reproduce the board's fixed 1920×1080 scaling for a
// fallback that shows for a couple of seconds.
export default function Loading() {
  return (
    <div
      className="min-h-screen bg-slate-900 p-6 flex flex-col gap-4"
      role="status"
      aria-label="Loading wall board"
    >
      <div className="flex items-center justify-between">
        <div className="h-8 w-72 rounded-md bg-slate-800 animate-pulse" />
        <div className="h-6 w-32 rounded bg-slate-800 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div
            key={item}
            className="min-h-[220px] bg-slate-800 rounded-2xl border border-white/[0.08] animate-pulse"
          />
        ))}
      </div>
      <span className="sr-only">Loading wall board content</span>
    </div>
  );
}
