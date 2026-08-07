"use client";

import type { KeyboardEvent } from "react";
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

interface SelectableTickProps {
  x?: number;
  y?: number;
  payload?: { index?: number };
  data: LeadTrendPoint[];
  onSelectRange?: (from: string, to: string) => void;
}

function SelectableTick({ x = 0, y = 0, payload, data, onSelectRange }: SelectableTickProps) {
  const point = payload?.index == null ? null : data[payload.index];
  if (!point) return null;

  const select = () => onSelectRange?.(point.rangeStart, point.rangeEnd);
  const handleKeyDown = (event: KeyboardEvent<SVGTextElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  };

  return (
    <text
      x={x}
      y={y}
      dy={16}
      textAnchor="middle"
      role={onSelectRange ? "button" : undefined}
      tabIndex={onSelectRange ? 0 : undefined}
      aria-label={onSelectRange ? `Filter leads to ${point.fullLabel}` : undefined}
      onClick={onSelectRange ? select : undefined}
      onKeyDown={onSelectRange ? handleKeyDown : undefined}
      className={onSelectRange ? "cursor-pointer fill-slate-500 hover:fill-slate-900" : "fill-slate-500"}
      fontSize={11}
    >
      {point.label}
    </text>
  );
}

export default function LeadTrendChart({
  data,
  showWebsite,
  showMeta,
  onSelectRange,
}: {
  data: LeadTrendPoint[];
  showWebsite: boolean;
  showMeta: boolean;
  onSelectRange?: (from: string, to: string) => void;
}) {
  const selectBarRange = (bar: { payload?: LeadTrendPoint }) => {
    if (!bar.payload) return;
    onSelectRange?.(bar.payload.rangeStart, bar.payload.rangeEnd);
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="rangeStart"
          axisLine={false}
          tickLine={false}
          tick={<SelectableTick data={data} onSelectRange={onSelectRange} />}
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
            onClick={onSelectRange ? selectBarRange : undefined}
            className={onSelectRange ? "cursor-pointer" : undefined}
          />
        )}
        {showMeta && (
          <Bar
            dataKey="meta"
            name="Meta"
            stackId="leads"
            fill="#db2777"
            radius={showWebsite ? [2, 2, 0, 0] : [2, 2, 2, 2]}
            onClick={onSelectRange ? selectBarRange : undefined}
            className={onSelectRange ? "cursor-pointer" : undefined}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
