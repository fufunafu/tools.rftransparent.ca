"use client";

function formatResponseTime(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function ChangeBadge({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null) return null;
  const positive = invert ? value < 0 : value > 0;
  const color = value === 0 ? "text-sand-400" : positive ? "text-green-600" : "text-red-500";
  return <span className={`text-xs font-medium ${color}`}>{value > 0 ? "+" : ""}{value}%</span>;
}

export interface MetricCard {
  label: string;
  value: number;
  prev: number;
  change: number | null | undefined;
  format: (n: number) => string;
  target?: number;
  invert?: boolean;
  subtitle?: string;
}

export default function MetricCards({ cards }: { cards: MetricCard[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => {
        const hasTarget = c.target != null;
        const target = c.target ?? 0;
        let progress = 0;
        let onTrack = true;
        if (hasTarget) {
          progress = target > 0 ? Math.min(c.value / target, 1) : 0;
          onTrack = c.value <= target;
        }
        return (
          <div key={c.label} className="bg-white rounded-xl border border-sand-200/60 p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-sand-400 uppercase tracking-wider">{c.label}</p>
              {hasTarget && (
                <span className={`text-[10px] font-medium ${onTrack ? "text-emerald-500" : "text-amber-500"}`}>
                  {onTrack ? "✓" : "!"} &le;{c.label === "Avg Response" ? "4h" : `${target}%`}
                </span>
              )}
            </div>
            <p className="text-xl font-semibold text-sand-900">{c.format(c.value)}</p>
            {c.subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{c.subtitle}</p>}
            {hasTarget && (
              <div className="mt-2 h-1.5 bg-sand-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${onTrack ? "bg-emerald-400" : "bg-amber-400"}`}
                  style={{ width: `${Math.max(progress * 100, 4)}%` }}
                />
              </div>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs text-sand-400">prev: {c.format(c.prev)}</span>
              <ChangeBadge value={c.change ?? null} invert={c.invert} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
