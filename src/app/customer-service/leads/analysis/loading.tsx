function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1900px] space-y-5" role="status" aria-label="Loading lead analysis">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Pulse className="h-3 w-24" />
          <Pulse className="h-7 w-36" />
          <Pulse className="h-4 w-80 max-w-[70vw]" />
        </div>
        <Pulse className="h-9 w-28" />
      </div>
      <Pulse className="h-16 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Pulse key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>
      <Pulse className="h-96 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Pulse key={index} className="h-80 w-full rounded-xl" />
        ))}
      </div>
      <span className="sr-only">Loading lead analysis</span>
    </div>
  );
}
