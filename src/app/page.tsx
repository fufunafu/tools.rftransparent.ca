import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import { getHomeDashboard } from "@/lib/home-dashboard";
import { formatCADWhole } from "@/lib/format";
import { BUSINESS_TIMEZONE } from "@/lib/dates";

export const metadata: Metadata = {
  title: "RF Transparent Tools",
  robots: { index: false, follow: false },
};

// Numbers are live; nothing here should be prerendered or held.
export const dynamic = "force-dynamic";

// ─── Presentation helpers ────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-slate-900",
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-red-600",
};

function Tile({
  label,
  href,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  href: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      className="block p-5 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-soft transition-all"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      {sub ? <p className="mt-1 text-sm text-slate-500 leading-snug">{sub}</p> : null}
    </Link>
  );
}

/** Shown in a tile's place when its data source is unreachable. */
function TileError({ label, error }: { label: string; error: string }) {
  return (
    <div className="p-5 bg-white rounded-xl border border-slate-200">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-2 text-sm text-slate-400">Unavailable</p>
      <p className="mt-1 text-xs text-slate-400 leading-snug">{error}</p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  const { sales, tickets, followups, automations } = await getHomeDashboard();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  // "Needs attention" is assembled from whatever loaded — a failed source
  // contributes nothing rather than a false all-clear, which is why the
  // errors are also listed at the bottom.
  //
  // Standing backlogs (thousands of overdue follow-ups, a pile of old tickets)
  // deliberately do NOT land here. They're real, but they're true every day,
  // and a list that's never empty stops being read. Those counts live in the
  // tiles instead; this list is for things that changed or broke.
  const attention: { text: string; href: string }[] = [];

  if (tickets.ok && tickets.value.oldest && tickets.value.oldest.ageDays >= tickets.value.alertDays) {
    const { client_name, ageDays } = tickets.value.oldest;
    attention.push({
      text: `Oldest open ticket — ${client_name} — has been open ${ageDays} days`,
      href: "/customer-service/problems",
    });
  }

  if (automations.ok && !automations.value.tableMissing) {
    for (const job of automations.value.failing) {
      attention.push({ text: `${job.label} failed ${relativeTime(job.run.started_at)}`, href: "/settings/automations" });
    }
    // Only jobs that ran before and then stopped — see AutomationHealth.neverRun
    // for why a job with no history at all isn't evidence of anything.
    for (const job of automations.value.silent) {
      attention.push({
        text: `${job.label} hasn't run since ${relativeTime(job.lastRun)}`,
        href: "/settings/automations",
      });
    }
  }

  if (sales.ok && sales.value.failedStores.length > 0) {
    attention.push({
      text: `Sales exclude ${sales.value.failedStores.join(", ")} — the store didn't respond`,
      href: "/health-check",
    });
  }

  const errors = [
    !sales.ok ? { label: "Sales", error: sales.error } : null,
    !tickets.ok ? { label: "Problem tickets", error: tickets.error } : null,
    !followups.ok ? { label: "Follow-ups", error: followups.error } : null,
    !automations.ok ? { label: "Automations", error: automations.error } : null,
  ].filter((e): e is { label: string; error: string } => e !== null);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Today</h2>
        <p className="text-sm text-slate-500 mt-1">{today}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <SalesTile sales={sales} />
        <TicketsTile tickets={tickets} />
        <FollowupsTile followups={followups} />
        <AutomationsTile automations={automations} />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Needs attention</p>
        {attention.length === 0 ? (
          <div className="p-5 bg-white rounded-xl border border-slate-200">
            <p className="text-sm text-slate-500">
              {errors.length > 0
                ? "Nothing flagged in the sources that loaded."
                : "Nothing to flag — tickets, follow-ups, and scheduled jobs are all current."}
            </p>
          </div>
        ) : (
          <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {attention.map((item) => (
              <li key={item.text}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-5 py-3 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="flex-1">{item.text}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errors.length > 0 && (
        <p className="text-xs text-slate-400">
          Couldn&apos;t load: {errors.map((e) => e.label).join(", ")}. The numbers above exclude these.
        </p>
      )}
    </div>
  );
}

// ─── Tiles ───────────────────────────────────────────────────────────────────

type Dash = Awaited<ReturnType<typeof getHomeDashboard>>;

function SalesTile({ sales }: { sales: Dash["sales"] }) {
  if (!sales.ok) return <TileError label="Sales today" error={sales.error} />;
  const { revenue, orders, priorAverage, priorDays, truncated, cachedAt } = sales.value;

  // Only claim a comparison when there's a baseline to compare against.
  const delta = priorAverage && priorAverage > 0 ? Math.round(((revenue - priorAverage) / priorAverage) * 100) : null;

  return (
    <Tile
      label="Sales today"
      href="/sales"
      value={formatCADWhole(revenue)}
      tone={delta === null ? "neutral" : delta >= 0 ? "good" : "warn"}
      sub={
        <>
          {orders} order{orders === 1 ? "" : "s"}
          {delta !== null && (
            <>
              {" · "}
              {delta >= 0 ? "+" : ""}
              {delta}% vs {priorDays}-day avg at this hour
            </>
          )}
          {truncated && " · partial"}
          {cachedAt && <span className="block text-xs text-slate-400">as of {relativeTime(cachedAt)}</span>}
        </>
      }
    />
  );
}

function TicketsTile({ tickets }: { tickets: Dash["tickets"] }) {
  if (!tickets.ok) return <TileError label="Open tickets" error={tickets.error} />;
  const { open, oldest, alertDays } = tickets.value;

  return (
    <Tile
      label="Open tickets"
      href="/customer-service/problems"
      value={open}
      tone={oldest && oldest.ageDays >= alertDays ? "warn" : open > 0 ? "neutral" : "good"}
      sub={oldest ? `oldest ${oldest.ageDays} days` : "none open"}
    />
  );
}

function FollowupsTile({ followups }: { followups: Dash["followups"] }) {
  if (!followups.ok) return <TileError label="Follow-ups due" error={followups.error} />;
  const { dueToday, overdue } = followups.value;

  return (
    <Tile
      label="Follow-ups due"
      href="/customer-service/follow-up"
      value={dueToday}
      sub={overdue > 0 ? `${overdue.toLocaleString()} in the overdue backlog` : "nothing overdue"}
    />
  );
}

function AutomationsTile({ automations }: { automations: Dash["automations"] }) {
  if (!automations.ok) return <TileError label="Automations" error={automations.error} />;
  const { tableMissing, failing, silent, neverRun, lastRunAt, total } = automations.value;

  if (tableMissing) {
    return (
      <Tile
        label="Automations"
        href="/settings/automations"
        value={<span className="text-slate-400">—</span>}
        sub="Run history not set up yet"
      />
    );
  }

  // Nothing has reported in yet — the history only starts at its first firing.
  // Claiming "All green" here would be asserting something we can't see.
  if (neverRun.length === total) {
    return (
      <Tile
        label="Automations"
        href="/settings/automations"
        value={<span className="text-slate-400">—</span>}
        sub={`${total} jobs · waiting for the first runs`}
      />
    );
  }

  const problems = failing.length + silent.length;
  return (
    <Tile
      label="Automations"
      href="/settings/automations"
      value={problems === 0 ? "All green" : problems}
      tone={failing.length > 0 ? "bad" : silent.length > 0 ? "warn" : "good"}
      sub={
        problems === 0
          ? [
              lastRunAt ? `last ran ${relativeTime(lastRunAt)}` : null,
              neverRun.length ? `${neverRun.length} yet to report` : null,
            ]
              .filter(Boolean)
              .join(" · ") || `${total} jobs`
          : `of ${total} jobs need a look`
      }
    />
  );
}
