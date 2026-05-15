"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface Props { distribution: Record<string, number> }

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#f59e0b" },
  hot_lead: { label: "Hot Lead", color: "#ef4444" },
  new: { label: "New", color: "#3b82f6" },
  considering: { label: "Considering", color: "#8b5cf6" },
  price_shopping: { label: "Price Shopping", color: "#14b8a6" },
  future_project: { label: "Future Project", color: "#a855f7" },
  no_answer: { label: "No Answer", color: "#64748b" },
  won: { label: "Won", color: "#10b981" },
  lost: { label: "Lost", color: "#7f1d1d" },
  duplicate: { label: "Duplicate", color: "#94a3b8" },
};

const ORDER = [
  "pending", "hot_lead", "new", "considering", "price_shopping",
  "future_project", "no_answer", "won", "lost", "duplicate",
];

function labelFor(status: string): string { return STATUS_META[status]?.label ?? status; }
function colorFor(status: string, fallbackIdx: number): string {
  const palette = ["#dc2626", "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981"];
  return STATUS_META[status]?.color ?? palette[fallbackIdx % palette.length];
}

export default function LeadStatusPanel({ distribution }: Props) {
  const data = useMemo(() => {
    return Object.entries(distribution)
      .map(([status, value]) => ({ status, label: labelFor(status), value }))
      .sort((a, b) => {
        const ai = ORDER.indexOf(a.status);
        const bi = ORDER.indexOf(b.status);
        if (ai === -1 && bi === -1) return b.value - a.value;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  }, [distribution]);

  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0 || total === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Follow-up Pipeline</h3>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 items-center">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
                innerRadius={50} outerRadius={90} paddingAngle={2}>
                {data.map((d, i) => (
                  <Cell key={d.status} fill={colorFor(d.status, i)} stroke="#fff" strokeWidth={1} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => {
                  const n = Number(v) || 0;
                  return [`${n} (${Math.round((n / total) * 100)}%)`, String(name)];
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e7e5e4" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5">
          {data.map((d, i) => {
            const pct = Math.round((d.value / total) * 100);
            return (
              <div key={d.status} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: colorFor(d.status, i) }} />
                <span className="flex-1 text-sand-800">{d.label}</span>
                <span className="text-sand-500 tabular-nums">{d.value}</span>
                <span className="text-xs text-sand-400 tabular-nums w-10 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
