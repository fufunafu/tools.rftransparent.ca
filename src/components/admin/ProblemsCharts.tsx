"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { PROBLEM_TYPES } from "@/lib/problem-tickets";

// Loaded via next/dynamic from ProblemsDashboard so recharts stays out of
// the route's initial bundle (same pattern as CustomerServiceCharts).

const AXIS_TICK = { fontSize: 11, fill: "#a39e93" };
const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid #e5e0da",
  fontSize: 12,
};

export interface MonthlyTypeRow {
  month: string; // "Jan" ... "Dec"
  [typeValue: string]: string | number;
}

// Tickets per month, stacked by problem type, for one year. Only the types
// that actually occur are rendered, but each keeps its fixed color.
export function MonthlyByTypeChart({
  data,
  presentTypes,
}: {
  data: MonthlyTypeRow[];
  presentTypes: string[];
}) {
  const types = PROBLEM_TYPES.filter((t) => presentTypes.includes(t.value));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} />
        <YAxis tick={AXIS_TICK} allowDecimals={false} width={30} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {types.map((t) => (
          <Bar
            key={t.value}
            dataKey={t.value}
            name={t.label}
            stackId="tickets"
            fill={t.color}
            // White seams so stacked segments stay separable for colorblind
            // readers (the palette's secondary encoding).
            stroke="#ffffff"
            strokeWidth={1}
            maxBarSize={42}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface YearlyRow {
  month: string; // "Jan" ... "Dec"
  [year: string]: string | number | null;
}

const YEAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

// Total tickets per month, one line per year — the "are we improving?" view.
// Colors are assigned per year (newest first) and stay with that year.
export function YearComparisonChart({
  data,
  years,
}: {
  data: YearlyRow[];
  years: number[]; // descending, newest first
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0da" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} />
        <YAxis tick={AXIS_TICK} allowDecimals={false} width={30} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {years.map((year, i) => (
          <Line
            key={year}
            type="monotone"
            dataKey={String(year)}
            name={String(year)}
            stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
