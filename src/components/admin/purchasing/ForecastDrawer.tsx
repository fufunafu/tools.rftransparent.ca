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

const fmtN = (n: number) => Math.round(n).toLocaleString("en-CA");

// Mirrors the sop_label decision in purchasing_reorder_view (migration 048)
// so the drawer can say in plain words *why* a SKU is flagged.
function reorderReasons(
  product: ProductWithMetrics,
  settings: PurchasingSettings,
): string[] {
  const label = product.sop_label;
  if (label === "ok" || label === "no_sales_data") return [];

  const monthly = product.avg_monthly_sales_grs + product.avg_monthly_sales_rf;
  const total = product.total_inventory;
  const lead = settings.lead_time_days;
  const capacity = product.storage_capacity;
  const target = product.restock_target;
  // reorder_point is target + lead-time demand, so the demand piece is
  // recoverable exactly without re-doing the seasonality math.
  const leadDemand = product.reorder_point - product.restock_target;
  const reasons: string[] = [];

  if (monthly === 0) {
    reasons.push(
      `No sales history yet — hardware SKUs are kept at a minimum of 50 units, and on hand + inbound is only ${fmtN(total)}.`,
    );
    return reasons;
  }

  if (label === "montreal_transfer" || label === "reorder_plus_montreal") {
    const waitDays = product.days_until_next_arrival ?? lead;
    const waitLabel =
      product.days_until_next_arrival !== null
        ? `the next inbound PO arrives in ~${fmtN(waitDays)} days`
        : `new stock can arrive (lead time is ${lead} days)`;
    reasons.push(
      `On hand alone covers about ${fmtN(product.days_of_stock_left ?? 0)} days — not enough to last until ${waitLabel}, so a Montreal transfer is needed to bridge the gap.`,
    );
  }

  if (label === "reorder" || label === "reorder_plus_montreal") {
    reasons.push(
      `On hand + inbound (${fmtN(total)}) is below the order point of ${fmtN(product.reorder_point)} units: customers will buy ~${fmtN(leadDemand)} while a new order ships (${lead} days), and we want ${fmtN(target)} still on the shelf when it lands.`,
    );
    // Explain where the target number comes from.
    if (product.category === "hardware") {
      reasons.push(
        `The ${fmtN(target)}-unit target is ~3 months of sales at the current rate (minimum 50 units).`,
      );
    } else {
      const fillFloor = settings.expected_fill * capacity;
      const covered = leadDemand * (settings.restock_cover_pct / 100);
      if (covered >= capacity) {
        reasons.push(
          `The target would be ${fmtN(covered)} (${fmtN(settings.restock_cover_pct)}% of a lead time of sales) but is capped at the storage capacity of ${fmtN(capacity)}.`,
        );
      } else if (fillFloor > covered) {
        reasons.push(
          `The ${fmtN(target)}-unit target comes from the minimum-fill setting: ${Math.round(settings.expected_fill * 100)}% of capacity ${fmtN(capacity)}.`,
        );
      } else {
        reasons.push(
          `The ${fmtN(target)}-unit target is ${fmtN(settings.restock_cover_pct)}% of one lead time of sales (~${fmtN(leadDemand)}) — the cover set in Settings.`,
        );
      }
    }
  }

  return reasons;
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

  const points = useMemo(() => forecast?.timeline ?? [], [forecast]);
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

  const reasons = reorderReasons(product, settings);
  // For hardware the fill floor *is* the capacity line, so only glass gets
  // a separate min-stock line.
  const fillFloor =
    product.category === "hardware"
      ? null
      : settings.expected_fill * product.storage_capacity;
  const fillPct = Math.round(settings.expected_fill * 100);
  // Skip the target line when it coincides with capacity (always true for
  // hardware, and for fast movers whose buffered demand hits the cap).
  const showTarget =
    Math.abs(product.restock_target - product.storage_capacity) >
    product.storage_capacity * 0.02;

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
              const target = product.reorder_point;
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
                      Below order point
                    </div>
                    <div className="text-sand-600 text-xs mt-0.5">
                      On hand + inbound = {onHandPlusInbound.toLocaleString("en-CA")} units,
                      order point is {fmtN(target)}. Short by{" "}
                      {fmtN(gap)}.
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
          {reasons.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200/60 p-4 text-sm">
              <div className="text-[11px] text-amber-600 uppercase tracking-wider font-medium mb-1.5">
                Why a reorder is suggested
              </div>
              <ul className="space-y-1.5 text-amber-900 text-xs leading-relaxed list-disc pl-4">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
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
                    <ReferenceLine y={product.storage_capacity} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain"
                      label={{ value: "Capacity", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }} />
                    {fillFloor !== null && fillFloor > 0 && (
                      <ReferenceLine y={fillFloor} stroke="#8b5cf6" strokeDasharray="4 4" ifOverflow="extendDomain"
                        label={{ value: `Min stock (${fillPct}%)`, position: "insideBottomRight", fontSize: 10, fill: "#8b5cf6" }} />
                    )}
                    {showTarget && product.restock_target > 0 && (
                      <ReferenceLine y={product.restock_target} stroke="#10b981" strokeDasharray="4 4" ifOverflow="extendDomain"
                        label={{ value: "Target at arrival", position: "insideBottomLeft", fontSize: 10, fill: "#10b981" }} />
                    )}
                    {product.reorder_point > 0 && (
                      <ReferenceLine y={product.reorder_point} stroke="#d97706" strokeDasharray="4 4" ifOverflow="extendDomain"
                        label={{ value: "Order point", position: "insideTopLeft", fontSize: 10, fill: "#d97706" }} />
                    )}
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
                {product.reorder_point > 0 && (
                  <span><span className="inline-block w-3 border-t border-dashed border-amber-600 mr-1.5 align-middle" />Order point</span>
                )}
                {showTarget && product.restock_target > 0 && (
                  <span><span className="inline-block w-3 border-t border-dashed border-emerald-500 mr-1.5 align-middle" />Target at arrival</span>
                )}
                {fillFloor !== null && fillFloor > 0 && (
                  <span><span className="inline-block w-3 border-t border-dashed border-violet-500 mr-1.5 align-middle" />Min stock ({fillPct}%)</span>
                )}
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
