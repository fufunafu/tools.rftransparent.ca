export default function Loading() {
  return <div role="status" aria-label="Loading customer workspace" className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
    <h1 className="text-3xl font-bold tracking-tight text-slate-950">HubSpot Dupe</h1>
    <p className="text-sm text-slate-500">Loading your customer workspace...</p>
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
    <div aria-hidden="true" className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white p-4">
      {[0, 1, 2, 3, 4].map(item => <div key={item} className="py-5"><div className="h-4 w-48 animate-pulse rounded bg-slate-100" /><div className="mt-3 h-3 w-64 animate-pulse rounded bg-slate-100" /></div>)}
    </div>
  </div>;
}
