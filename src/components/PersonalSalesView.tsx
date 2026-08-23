import Link from "next/link";
import { personalSalesSummary, type PersonalSalesLead } from "@/lib/personal-sales";

function currency(value: number | string | null) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function dueLabel(value: string | null) {
  if (!value) return "No follow-up date";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function PersonalSalesView({
  employeeName,
  leads,
  loadError,
}: {
  employeeName: string;
  leads: PersonalSalesLead[];
  loadError: string | null;
}) {
  const now = new Date();
  const summary = personalSalesSummary(leads, now);
  const work = leads
    .filter((lead) => !lead.closed_at)
    .sort((a, b) => (a.next_followup_at ?? "9999").localeCompare(b.next_followup_at ?? "9999"))
    .slice(0, 12);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600">Sales</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">My sales and follow-ups</h1>
        <p className="mt-2 text-sm text-slate-500">Current work attributed to {employeeName}.</p>
      </header>

      {loadError && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{loadError}</p>
      )}

      <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-4" aria-label="My sales summary">
        {[
          ["Active quotes", summary.active, "text-slate-950"],
          ["Due today", summary.dueToday, "text-amber-700"],
          ["Overdue", summary.overdue, summary.overdue > 0 ? "text-red-700" : "text-slate-950"],
          ["Won", summary.won, "text-emerald-700"],
        ].map(([label, value, tone], index) => (
          <div key={label as string} className={`px-4 py-5 ${index % 2 ? "border-l border-slate-100" : ""} ${index > 1 ? "border-t border-slate-100 sm:border-t-0" : ""} ${index > 1 ? "sm:border-l" : ""}`}>
            <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="personal-sales-work">
        <div className="mb-2 flex min-h-11 items-center justify-between px-1">
          <h2 id="personal-sales-work" className="text-xs font-bold uppercase tracking-wider text-slate-500">Next work</h2>
          <Link href="/customer-service/follow-up" className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-bold text-blue-600 active:bg-blue-50">Full workspace</Link>
        </div>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {work.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-bold text-slate-700">No active quotes assigned</p>
              <p className="mt-1 text-xs text-slate-500">New quotes attributed to you will appear here.</p>
            </div>
          ) : work.map((lead) => (
            <div key={lead.id} className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-950">{lead.customer_name || lead.draft_name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{dueLabel(lead.next_followup_at)} · {lead.lead_status.replace(/_/g, " ")}</span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-slate-800">{currency(lead.quote_amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
