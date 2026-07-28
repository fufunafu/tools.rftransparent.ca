"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// Extracted from WarehouseDashboard and loaded via next/dynamic so recharts
// stays out of the route's initial bundle (same pattern as ShopifyCharts).

interface DayData {
  date: string;
  boxes_built: number;
  orders_packed: number;
  walkin_pickup: number;
}

const STEP_COLORS = {
  boxes_built: "#6366f1",
  orders_packed: "#f59e0b",
  walkin_pickup: "#10b981",
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function WarehouseCharts({ chartData }: { chartData: DayData[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData}>
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 12 }}
          stroke="#a8a29e"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          stroke="#a8a29e"
          allowDecimals={false}
        />
        <Tooltip
          labelFormatter={(label) => formatDate(String(label))}
          contentStyle={{
            borderRadius: "0.5rem",
            border: "1px solid #e7e5e4",
            fontSize: "0.875rem",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "0.75rem" }}
        />
        <Bar
          dataKey="boxes_built"
          name="Boxes Built"
          stackId="a"
          fill={STEP_COLORS.boxes_built}
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="orders_packed"
          name="Orders Packed"
          stackId="a"
          fill={STEP_COLORS.orders_packed}
        />
        <Bar
          dataKey="walkin_pickup"
          name="Walk-in / Pick-up"
          stackId="a"
          fill={STEP_COLORS.walkin_pickup}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
