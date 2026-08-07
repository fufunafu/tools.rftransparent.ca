export default function AssistantSettingsLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse space-y-5" aria-label="Loading assistant settings">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-slate-200" />
          <div className="h-8 w-56 rounded bg-slate-200" />
        </div>
        <div className="flex gap-6">
          <div className="h-10 w-28 rounded bg-slate-200" />
          <div className="h-10 w-24 rounded bg-slate-200" />
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <div className="flex h-12 items-end gap-3 border-b border-slate-200 pb-3">
            <div className="h-5 w-24 rounded bg-slate-200" />
            <div className="h-5 w-16 rounded bg-slate-200" />
            <div className="h-5 w-16 rounded bg-slate-200" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-44 rounded-lg border border-slate-200 bg-white p-4">
                <div className="h-4 w-2/3 rounded bg-slate-200" />
                <div className="mt-4 h-3 w-full rounded bg-slate-100" />
                <div className="mt-2 h-3 w-5/6 rounded bg-slate-100" />
                <div className="mt-8 h-3 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-[34rem] rounded-lg border border-slate-200 bg-white p-4">
          <div className="h-5 w-40 rounded bg-slate-200" />
          <div className="mt-5 h-72 rounded bg-slate-100" />
          <div className="mt-4 h-9 rounded bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
