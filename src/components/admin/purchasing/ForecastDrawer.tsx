"use client";

import { useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, ReferenceDot,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  consumptionBetween,
  pickSeasonality,
} from "@/lib/purchasing/seasonality";
import type {
  ForecastPoint,
  InventoryForecast,
  ProductWithMetrics,
  PurchasingSettings,
} from "@/lib/purchasing/types";

const DAY_MS = 86_400_000;
// Granularity of the projected-inventory chart: emit a data point every N
// days between events so the line shows real time-proportional slope and
// month-to-month seasonality changes.
const CHART_STEP_DAYS = 3;

function parseISO(d: string): number {
  return new Date(d + "T00:00:00Z").getTime();
}
function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function densifyTimeline(
  points: ForecastPoint[],
  baseMonthly: number,
  settings: PurchasingSettings,
): ForecastPoint[] {
  if (points.length < 2) return points;
  const seasonality = pickSeasonality(settings);
  const out: ForecastPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    if (i === 0) { out.push(cur); continue; }
    const prev = points[i - 1];
    const startMs = parseISO(prev.date);
    const endMs = parseISO(cur.date);
    const stepMs = CHART_STEP_DAYS * DAY_MS;
    for (let t = startMs + stepMs; t < endMs; t += stepMs) {
      const consumed = consumptionBetween(
        prev.date,
        isoFromMs(t),
        baseMonthly,
        seasonality,
      );
      const inv = Math.max(0, prev.inventory - consumed);
      out.push({ date: isoFromMs(t), inventory: inv });
    }
    out.push(cur);
  }
  return out;
}

interface Props {
  product: ProductWithMetrics;
  forecast: InventoryForecast | null;
  settings: PurchasingSettings;
  onClose: () => void;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function ForecastDrawer({ product, forecast, settings, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const points = forecast?.timeline ?? [];
  const arrivals = points.filter((p) => p.event === "arrival");
  const stockoutPoint = points.find((p) => p.event === "stockout");

  const baseMonthly = product.avg_monthly_sales_grs + product.avg_monthly_sales_rf;
  const chartData = useMemo(
    () =>
      densifyTimeline(points, baseMonthly, settings).map((p) => ({
        ...p,
        t: parseISO(p.date),
      })),
    [points, baseMonthly, settings],
  );
  const xDomain: [number, number] = chartData.length >= 2
    ? [chartData[0].t, chartData[chartData.length - 1].t]
    : [0, 1];

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-sand-200/60 px-5 py-3 flex items-baseline justify-between">
          <div>
            <div className="text-xs text-sand-500 font-mono">{product.sku}</div>
            <h2 className="text-lg font-semibold text-sand-900">{product.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sand-500 hover:text-sand-900 text-sm">Close ✕</button>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="On hand" value={product.current_inventory.toLocaleString("en-CA")} />
            <Stat label="Inbound" value={product.inbound.toLocaleString("en-CA")} />
            <Stat label="Monthly sales" value={(product.avg_monthly_sales_grs + product.avg_monthly_sales_rf).toFixed(1)} />
            <Stat label="Capacity" value={product.storage_capacity.toLocaleString("en-CA")} />
          </div>
          <div className="bg-sand-50 rounded-xl border border-sand-200/60 p-4 text-sm">
            {forecast?.projected_stockout_date ? (
              <div>
                <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Projected stockout</div>
                <div className="text-2xl font-semibold text-red-700 tabular-nums">
                  {fmtDate(forecast.projected_stockout_date)}
                </div>
                <div className="text-sand-600 text-xs mt-0.5">
                  in {forecast.days_until_stockout} day{forecast.days_until_stockout === 1 ? "" : "s"}
                  {arrivals.length > 0 && `, after factoring in ${arrivals.length} incoming PO${arrivals.length === 1 ? "" : "s"}`}
                </div>
              </div>
            ) : (() => {
              // No projected stockout doesn't always mean "safe" — for SKUs
              // flagged for reorder because they're under the target stock
              // (especially hardware with no sales data → 50-unit floor),
              // the forecast can't predict a stockout because daily_sales
              // is 0 or the projection ends above zero, but the SKU still
              // needs to be topped up to the target.
              const onHandPlusInbound = product.current_inventory + product.inbound;
              const target = product.storage_capacity;
              const belowTarget = onHandPlusInbound < target;
              const flaggedForReorder =
                product.sop_label === "reorder" ||
                product.sop_label === "reorder_plus_montreal" ||
                product.sop_label === "montreal_transfer";

              if (belowTarget && flaggedForReorder) {
                const gap = Math.max(0, target - onHandPlusInbound);
                return (
                  <div>
                    <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Status</div>
                    <div className="text-xl font-semibold text-amber-700">
                      Below target stock
                    </div>
                    <div className="text-sand-600 text-xs mt-0.5">
                      On hand + inbound = {onHandPlusInbound.toLocaleString("en-CA")} units,
                      target is {target.toLocaleString("en-CA")}. Short by{" "}
                      {gap.toLocaleString("en-CA")}.
                      {product.avg_monthly_sales_grs + product.avg_monthly_sales_rf === 0 &&
                        " The chart shows no stockout because this SKU has no sales history yet — we still want to keep the minimum on hand."}
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Projected stockout</div>
                  <div className="text-xl font-semibold text-green-700">Safe — no stockout within the next year</div>
                  {arrivals.length > 0 && (
                    <div className="text-sand-600 text-xs mt-0.5">
                      {arrivals.length} incoming PO{arrivals.length === 1 ? "" : "s"} included
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {points.length >= 2 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-4">
              <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-3">Projected inventory</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="t" type="number" scale="time" domain={xDomain}
                      tick={{ fontSize: 11 }}
                      minTickGap={50}
                      tickFormatter={(ms) => new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(ms) => fmtDate(isoFromMs(ms as number))}
                      formatter={(v) => [Number(v).toLocaleString("en-CA", { maximumFractionDigits: 0 }), "units"]} />
                    <ReferenceLine y={product.storage_capacity} stroke="#94a3b8" strokeDasharray="4 4"
                      label={{ value: "Capacity", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }} />
                    <ReferenceLine y={0} stroke="#dc2626" />
                    <Line type="linear" dataKey="inventory" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    {arrivals.map((a) => (
                      <ReferenceDot key={a.date + (a.po_number ?? "")} x={parseISO(a.date)} y={a.inventory}
                        r={5} fill="#10b981" stroke="white" strokeWidth={2} />
                    ))}
                    {stockoutPoint && (
                      <ReferenceDot x={parseISO(stockoutPoint.date)} y={0} r={5} fill="#dc2626" stroke="white" strokeWidth={2} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-sand-500">
                <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />PO arrival</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1.5" />Stockout</span>
                <span><span className="inline-block w-3 border-t border-dashed border-sand-400 mr-1.5 align-middle" />Capacity</span>
              </div>
            </div>
          )}
          {arrivals.length > 0 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-4">
              <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Incoming purchase orders</div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-sand-100">
                  {arrivals.map((a) => (
                    <tr key={a.date + (a.po_number ?? "")}>
                      <td className="py-1.5 font-mono text-xs text-accent">{a.po_number}</td>
                      <td className="py-1.5 text-sand-600">{fmtDate(a.date)}</td>
                      <td className="py-1.5 text-right tabular-nums">+{a.qty?.toLocaleString("en-CA")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-3">
      <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">{label}</div>
      <div className="text-lg font-semibold text-sand-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
