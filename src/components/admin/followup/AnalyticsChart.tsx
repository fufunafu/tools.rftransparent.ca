"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface MonthData {
  month: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  conversion_rate: number;
  quoted_value: number;
  won_value: number;
}

export default function AnalyticsChart({ data }: { data: MonthData[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <h3 className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-4">Monthly Conversion Trends</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a3a3a3" }} />
            <YAxis yAxisId="count" tick={{ fontSize: 11, fill: "#a3a3a3" }} width={35} />
            <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 11, fill: "#a3a3a3" }} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
              formatter={(value, name) => {
                const v = Number(value);
                if (name === "conversion_rate") return [`${v}%`, "Conversion Rate"];
                if (name === "won") return [v, "Won"];
                if (name === "lost") return [v, "Lost"];
                if (name === "total") return [v, "Total Quotes"];
                return [v, String(name)];
              }}
            />
            <Bar yAxisId="count" dataKey="won" stackId="outcome" fill="#22c55e" radius={[0, 0, 0, 0]} name="won" />
            <Bar yAxisId="count" dataKey="lost" stackId="outcome" fill="#cbd5e1" radius={[4, 4, 0, 0]} name="lost" />
            <Bar yAxisId="count" dataKey="total" fill="transparent" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 2" name="total" />
            <Line yAxisId="rate" type="monotone" dataKey="conversion_rate" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} name="conversion_rate" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-6 mt-3 text-xs text-sand-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500" /> Won</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-300" /> Lost</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-amber-500 rounded" /> Conversion %</span>
      </div>
    </div>
  );
}
