"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LeadTrendPoint } from "@/lib/lead-analytics";

export default function LeadTrendChart({
  data,
  showWebsite,
  showMeta,
}: {
  data: LeadTrendPoint[];
  showWebsite: boolean;
  showMeta: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#64748b", fontSize: 11 }}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#64748b", fontSize: 11 }}
        />
        <Tooltip
          labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
          formatter={(value: unknown, name: unknown) => [Number(value), String(name)]}
          contentStyle={{
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
            fontSize: 12,
          }}
          cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
        />
        {showWebsite && (
          <Bar
            dataKey="website"
            name="Website"
            stackId="leads"
            fill="#2563eb"
            radius={showMeta ? [0, 0, 2, 2] : [2, 2, 2, 2]}
          />
        )}
        {showMeta && (
          <Bar
            dataKey="meta"
            name="Meta"
            stackId="leads"
            fill="#db2777"
            radius={showWebsite ? [2, 2, 0, 0] : [2, 2, 2, 2]}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
