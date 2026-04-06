"use client";

interface Card {
  label: string;
  value: string | number;
  color: string;
  subtitle?: string;
}

export default function SummaryCards({ cards }: { cards: Card[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-sand-200/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${c.color}`} />
            <p className="text-[11px] text-sand-400 uppercase tracking-wider">{c.label}</p>
          </div>
          <p className="text-xl font-semibold text-sand-900">{c.value}</p>
          {c.subtitle && <p className="text-[11px] text-sand-400 mt-0.5">{c.subtitle}</p>}
        </div>
      ))}
    </div>
  );
}
