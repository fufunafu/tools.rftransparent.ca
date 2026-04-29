"use client";

import { useState, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { FollowUpLead } from "@/lib/followup";

type LostLead = FollowUpLead & { closing_note: string | null };

interface Props {
  reasons: Record<string, number>;
  store: string;
  range: string;
}

// Stable, distinguishable palette tuned for the dashboard's muted neutrals.
const COLORS = ["#dc2626", "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981", "#ec4899", "#64748b", "#f97316"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

export default function LossReasonsPanel({ reasons, store, range }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [leads, setLeads] = useState<LostLead[] | null>(null);
  const [loading, setLoading] = useState(false);

  const data = useMemo(
    () =>
      Object.entries(reasons)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    [reasons],
  );

  const total = data.reduce((s, d) => s + d.value, 0);
  const colorFor = (i: number) => COLORS[i % COLORS.length];

  async function selectReason(reason: string) {
    if (active === reason) {
      setActive(null);
      setLeads(null);
      return;
    }
    setActive(reason);
    setLoading(true);
    setLeads(null);
    try {
      const params = new URLSearchParams({
        view: "lost_details",
        store,
        range,
        close_reason: reason,
      });
      const res = await fetch(`/api/customer-service/follow-up?${params}`);
      const body = await res.json();
      setLeads(body.leads ?? []);
    } finally {
      setLoading(false);
    }
  }

  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Loss Reasons</h3>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 items-center">
        {/* Pie */}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                onClick={(d: { name?: string }) => d.name && selectReason(d.name)}
              >
                {data.map((d, i) => (
                  <Cell
                    key={d.name}
                    fill={colorFor(i)}
                    stroke={active === d.name ? "#0f172a" : "#fff"}
                    strokeWidth={active === d.name ? 2 : 1}
                    style={{ cursor: "pointer", opacity: active && active !== d.name ? 0.45 : 1 }}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => {
                  const n = Number(v) || 0;
                  return [`${n} (${Math.round((n / total) * 100)}%)`, String(name)];
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e7e5e4" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend / clickable list */}
        <div className="space-y-1.5">
          {data.map((d, i) => {
            const pct = Math.round((d.value / total) * 100);
            const isActive = active === d.name;
            return (
              <button
                key={d.name}
                onClick={() => selectReason(d.name)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                  isActive ? "bg-sand-100" : "hover:bg-sand-50"
                }`}
              >
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: colorFor(i) }} />
                <span className="flex-1 text-sand-800">{d.name}</span>
                <span className="text-sand-500 tabular-nums">{d.value}</span>
                <span className="text-xs text-sand-400 tabular-nums w-10 text-right">{pct}%</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Drill-down */}
      {active && (
        <div className="mt-5 pt-5 border-t border-sand-200/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-sand-800">
              {active}{" "}
              <span className="text-sand-400 font-normal">
                — {leads?.length ?? "…"} {leads?.length === 1 ? "lead" : "leads"}
              </span>
            </h4>
            <button
              onClick={() => { setActive(null); setLeads(null); }}
              className="text-xs text-sand-500 hover:text-sand-700"
            >
              Close
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-sand-400 py-4">Loading…</p>
          ) : leads && leads.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {leads.map((l) => (
                <div key={l.id} className="px-3 py-2 rounded-lg bg-sand-50 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-sand-900">{l.customer_name || "Unknown"}</span>
                      <span className="ml-2 text-xs text-sand-400">{l.draft_name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-sand-500 whitespace-nowrap">
                      <span className="tabular-nums">{formatAmount(Number(l.quote_amount))}</span>
                      <span>{formatDate(l.closed_at)}</span>
                    </div>
                  </div>
                  {l.closing_note ? (
                    <p className="mt-1 text-sand-600 whitespace-pre-wrap">{l.closing_note}</p>
                  ) : l.notes ? (
                    <p className="mt-1 text-sand-600 whitespace-pre-wrap">{l.notes}</p>
                  ) : (
                    <p className="mt-1 text-sand-400 italic text-xs">No notes</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-sand-400 py-4">No leads with this reason in the current range.</p>
          )}
        </div>
      )}
    </div>
  );
}
