function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

function QueueRow({ index }: { index: number }) {
  return (
    <div
      className="grid min-h-16 grid-cols-[23%_9%_16%_14%_18%_12%_8%] items-center border-b border-sand-100 px-4"
      aria-hidden="true"
    >
      <div className="min-w-0 space-y-2 pr-5">
        <Pulse className={`h-3.5 ${index % 3 === 0 ? "w-3/4" : "w-1/2"}`} />
        <Pulse className="h-2.5 w-4/5" />
      </div>
      <Pulse className="h-3 w-12" />
      <div className="space-y-2 px-3">
        <Pulse className="h-3 w-16" />
        <Pulse className="h-2.5 w-11" />
      </div>
      <Pulse className="ml-3 h-5 w-16 rounded-full" />
      <div className="space-y-2 px-3">
        <Pulse className="h-3 w-14" />
        <Pulse className="h-2.5 w-20" />
      </div>
      <Pulse className="ml-3 h-5 w-14 rounded-full" />
      <Pulse className="ml-auto h-3 w-8" />
    </div>
  );
}

export default function Loading() {
  return (
    <div
      className="mx-auto max-w-[1900px] space-y-6"
      role="status"
      aria-label="Loading leads dashboard"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Pulse className="h-7 w-20" />
          <Pulse className="h-4 w-72 max-w-[70vw]" />
        </div>
        <Pulse className="h-9 w-24" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(420px,440px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="overflow-hidden rounded-lg border border-sand-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-sand-200 px-4 py-3">
              <div className="space-y-2">
                <Pulse className="h-4 w-24" />
                <Pulse className="h-3 w-72 max-w-full" />
              </div>
              <Pulse className="h-7 w-32" />
            </div>
            <div className="flex h-[150px] items-end gap-2 px-5 pb-4 pt-5" aria-hidden="true">
              {[38, 62, 45, 78, 56, 84, 68, 92, 64, 75, 58, 80].map((height, index) => (
                <div
                  key={`${height}-${index}`}
                  className="flex-1 animate-pulse rounded-t-sm bg-slate-200"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 border-t border-sand-200 px-4 py-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="space-y-2">
                  <Pulse className="h-3 w-14" />
                  <Pulse className="h-5 w-10" />
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-sand-200 bg-white">
            <div className="grid grid-cols-3 divide-x divide-sand-200">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex min-h-32 flex-col gap-2 p-3">
                  <Pulse className="h-3 w-20" />
                  <Pulse className="h-6 w-12" />
                  <div className="mt-auto grid grid-cols-2 gap-2 border-t border-sand-100 pt-2">
                    <Pulse className="h-8 w-full" />
                    <Pulse className="h-8 w-full" />
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-sand-200">
              <div className="flex justify-between border-b border-sand-200 px-4 py-3">
                <Pulse className="h-3 w-32" />
                <Pulse className="h-3 w-16" />
              </div>
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-b border-sand-100 px-4 py-2">
                  <Pulse className="h-3 w-28" />
                  <Pulse className="h-3 w-16" />
                  <Pulse className="h-3 w-16" />
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="min-w-0 overflow-hidden rounded-lg border border-sand-200 bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-sand-200 px-4 py-3">
            <div className="space-y-2">
              <Pulse className="h-4 w-24" />
              <Pulse className="h-3 w-16" />
            </div>
            <Pulse className="hidden h-3 w-56 sm:block" />
          </div>
          <div className="flex flex-wrap gap-2 border-b border-sand-200 bg-sand-50 px-3 py-3">
            <Pulse className="h-9 min-w-[220px] flex-1" />
            <Pulse className="h-9 w-44" />
            <Pulse className="h-9 w-36" />
            <Pulse className="h-9 w-32" />
          </div>
          <div className="hidden grid-cols-[23%_9%_16%_14%_18%_12%_8%] border-b border-sand-200 px-4 py-3 md:grid">
            {["w-10", "w-12", "w-14", "w-12", "w-20", "w-10", "w-6"].map((width, index) => (
              <Pulse key={`${width}-${index}`} className={`h-2.5 ${width}`} />
            ))}
          </div>
          <div className="hidden md:block">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => <QueueRow key={item} index={item} />)}
          </div>
          <div className="space-y-4 p-4 md:hidden">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="space-y-3 border-b border-sand-100 pb-4">
                <Pulse className="h-4 w-2/5" />
                <Pulse className="h-3 w-4/5" />
                <div className="flex gap-2">
                  <Pulse className="h-5 w-16 rounded-full" />
                  <Pulse className="h-5 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <span className="sr-only">Loading current lead data</span>
    </div>
  );
}
