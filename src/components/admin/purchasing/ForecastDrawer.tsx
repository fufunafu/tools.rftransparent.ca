"use client";

import { seasonalMonthlySales } from "@/lib/purchasing/seasonality";

import { useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, ReferenceDot,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type {
  InventoryForecast,
  ProductWithMetrics,
  PurchasingSettings,
} from "@/lib/purchasing/types";

function parseISO(d: string): number {
  return new Date(d + "T00:00:00Z").getTime();
}
function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface Props {
  product: ProductWithMetrics;
  forecast: InventoryForecast | null;
  settings: PurchasingSettings;
  onClose: () => void;
}

const fmtN = (n: number) => Math.round(n).toLocaleString("en-CA");

function reorderReasons(product: ProductWithMetrics, settings: PurchasingSettings): string[] {
  const reasons: string[] = [];
  const eta = product.planning?.order_arrival_date;
  if (product.transfer_requirement > 0) reasons.push(
    `A bridge of ${fmtN(product.transfer_requirement)} units is needed before a new supplier order can arrive${eta ? ` on ${fmtDate(eta)}` : ` in ${settings.lead_time_days} days`}. The calculation includes confirmed arrivals on their actual dates.`,
  );
  if (product.suggested_qty > 0) reasons.push(
    `Order ${fmtN(product.suggested_qty)} units from the supplier to cover later demand and the stock target. The calculated need is ${fmtN(product.perfect_qty)} units${product.category === "glass" ? ", rounded up to an allowed crate quantity" : ""}. Any bridge transfer is counted separately so its units are not ordered twice.`,
  );
  if (product.avg_monthly_sales_grs + product.avg_monthly_sales_rf === 0) reasons.push(
    "The annual sales baseline is zero. Any suggested purchase fills the configured minimum stock target; it is not evidence of current demand.",
  );
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

  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        t: p.timestamp ?? parseISO(p.date),
      })),
    [points],
  );
  const xDomain: [number, number] = chartData.length >= 2
    ? [chartData[0].t, chartData[chartData.length - 1].t]
    : [0, 1];

  const reasons = reorderReasons(product, settings);
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Inventory graph for ${product.sku}`} className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
            <Stat label="Monthly sales" value={seasonalMonthlySales(product.avg_monthly_sales_grs + product.avg_monthly_sales_rf, settings).toFixed(1)} />
            <Stat label="Capacity" value={product.storage_capacity.toLocaleString("en-CA")} />
          </div>
          <div className="bg-sand-50 rounded-xl border border-sand-200/60 p-4 text-sm">
            {!forecast ? (
              <div>
                <div className="font-medium text-amber-700">Forecast unavailable</div>
                <p className="mt-1 text-xs text-sand-600">Refresh inventory to load this product&apos;s graph and stockout estimate.</p>
              </div>
            ) : forecast.projected_stockout_date ? (
              <div>
                <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Projected stockout</div>
                <div className={"text-2xl font-semibold tabular-nums " + ((forecast.days_until_stockout ?? 365) < settings.lead_time_days ? "text-red-700" : "text-sand-900")}>
                  {fmtDate(forecast.projected_stockout_date)}
                </div>
                <div className="text-sand-600 text-xs mt-0.5">
                  in {forecast.days_until_stockout} day{forecast.days_until_stockout === 1 ? "" : "s"}
                  {arrivals.length > 0 && `, after factoring in ${arrivals.length} incoming PO${arrivals.length === 1 ? "" : "s"}`}
                </div>
              </div>
            ) : (() => {
              // No projected stockout doesn't always mean "safe" - for SKUs
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
                        " The chart shows no stockout because this SKU has no sales history yet - we still want to keep the minimum on hand."}
                    </div>
                  </div>
                );
              }

              return (
                <div>
                  <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium">Projected stockout</div>
                  <div className="text-xl font-semibold text-green-700">No projected stockout within the next year</div>
                  {arrivals.length > 0 && (
                    <div className="text-sand-600 text-xs mt-0.5">
                      {arrivals.length} incoming PO{arrivals.length === 1 ? "" : "s"} included
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {(product.planning?.unconfirmed_inbound ?? 0) > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            {product.planning!.unconfirmed_inbound} inbound units have an overdue or missing ETA ({product.planning!.unconfirmed_orders.join(", ")}). They are excluded from the forecast and recommendations until the delivery dates are confirmed. Check these orders before creating another order.
          </div>}
          {reasons.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200/60 p-4 text-sm">
              <div className="text-[11px] text-amber-600 uppercase tracking-wider font-medium mb-1.5">
                Planning recommendation
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
                      tickFormatter={(ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "UTC", month: "short", day: "numeric" })} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(ms) => fmtDate(isoFromMs(ms as number))}
                      formatter={(v) => [Number(v).toLocaleString("en-CA", { maximumFractionDigits: 0 }), "units"]} />
                    <ReferenceLine y={product.storage_capacity} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain"
                      label={{ value: product.category === "hardware" ? "Stock target" : "Capacity", position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }} />
                    <ReferenceLine y={0} stroke="#dc2626" />
                    <Line type="linear" dataKey="inventory" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                    {arrivals.map((a) => (
                      <ReferenceDot key={a.date + (a.po_number ?? "")} x={parseISO(a.date)} y={a.inventory}
                        r={5} fill="#10b981" stroke="white" strokeWidth={2} />
                    ))}
                    {stockoutPoint && (
                      <ReferenceDot x={stockoutPoint.timestamp ?? parseISO(stockoutPoint.date)} y={0} r={5} fill="#dc2626" stroke="white" strokeWidth={2} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-sand-500">
                <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />PO arrival</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1.5" />Stockout</span>
                <span><span className="inline-block w-3 border-t border-dashed border-sand-400 mr-1.5 align-middle" />{product.category === "hardware" ? "Stock target" : "Capacity"}</span>
              </div>
              <CalcNote product={product} settings={settings} />
            </div>
          )}
          {arrivals.length > 0 && (
            <div className="bg-white rounded-xl border border-sand-200/60 p-4">
              <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-2">Incoming purchase orders</div>
              <div className="overflow-x-auto">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalcNote({ product, settings }: { product: ProductWithMetrics; settings: PurchasingSettings }) {
  const plan = product.planning;
  if (!plan) return null;
  const base = product.avg_monthly_sales_grs + product.avg_monthly_sales_rf;
  const rows: Array<[string, string]> = [
    ["Sales baseline", `${fmtN(base * 12)} annual net units ÷ 12 = ${base.toFixed(1)} per month before seasonality`],
    ["Daily forecast", `Each month's seasonal demand ÷ that month's actual number of days, with ${settings.annual_growth_pct}% forecast growth`],
    ["Supplier lead time", `${fmtDate(plan.as_of)} to ${fmtDate(plan.order_arrival_date)}: ${fmtN(plan.lead_demand)} units of forecast demand`],
    ["Coverage target", product.category === "hardware"
      ? `${fmtN(plan.target_demand)} units: the next three months of forecast demand after supplier arrival, with a 50-unit minimum`
      : `${fmtN(plan.target_demand)} units: the higher of ${fmtN(plan.cover_demand)} future cover-period demand or the ${fmtN(settings.expected_fill * product.storage_capacity)} stock floor, capped at capacity`],
    ["Dated inbound counted", `${fmtN(plan.counted_inbound)} units within the protected coverage period. Later, overdue and undated shipments cannot hide earlier shortages.`],
    ["Montreal bridge", `${fmtN(product.transfer_requirement)} units before supplier replenishment can arrive`],
    ["Supplier order", `${fmtN(product.perfect_qty)} additional units needed; ${fmtN(product.suggested_qty)} suggested after rounding`],
  ];
  return <div className="mt-3 border-t border-sand-100 pt-3">
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-sand-400">How the recommendation is calculated</div>
    <div className="space-y-2">{rows.map(([label, value]) => <div key={label} className="text-xs sm:flex sm:gap-2"><span className="block shrink-0 font-medium text-sand-500 sm:w-40">{label}</span><span className="text-sand-700 tabular-nums">{value}</span></div>)}</div>
  </div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] font-medium uppercase tracking-wider text-sand-400">{label}</div><div className="mt-1 font-semibold tabular-nums text-sand-900">{value}</div></div>;
}
