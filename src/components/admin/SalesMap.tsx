"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalePoint {
  lat: number;
  lng: number;
  city: string;
  province: string;
  country: string;
  amount: number;
  currency: string;
  order: string;
  date: string;
  tags: string[];
}

interface RepData {
  tag: string;
  orders: number;
  revenue: number;
}

interface RegionData {
  region: string;
  orders: number;
  revenue: number;
}

interface GeoData {
  points: SalePoint[];
  reps: RepData[];
  regions: RegionData[];
  currency: string;
}

const RANGE_OPTIONS = [
  { days: 7, label: "7D" },
  { days: 30, label: "30D" },
  { days: 90, label: "90D" },
  { days: 365, label: "1Y" },
];

// Dynamically import the map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("./SalesMapView"), { ssr: false });

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SalesMap({ storeId }: { storeId: string }) {
  const [data, setData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(30);
  const [viewMode, setViewMode] = useState<"map" | "reps" | "regions">("map");

  const load = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    setRange(days);
    try {
      const res = await fetch(`/api/shopify/geo?storeId=${storeId}&days=${days}`);
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(30); }, [load]);

  return (
    <div className="bg-white rounded-xl border border-sand-200 overflow-hidden">
      {/* Header with range + view toggles */}
      <div className="px-5 py-4 border-b border-sand-100 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-sand-900">Sales Geography & Reps</h3>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex gap-1">
            {(["map", "reps", "regions"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors capitalize ${
                  viewMode === v
                    ? "bg-sand-900 text-white"
                    : "bg-sand-100 text-sand-500 hover:bg-sand-200"
                }`}
              >
                {v === "reps" ? "Sales Reps" : v === "regions" ? "Regions" : "Map"}
              </button>
            ))}
          </div>
          {/* Range toggle */}
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => load(opt.days)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  range === opt.days
                    ? "bg-sand-900 text-white"
                    : "bg-sand-100 text-sand-500 hover:bg-sand-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {loading && (
          <div className="h-80 flex items-center justify-center text-sand-400 text-sm animate-pulse">
            Loading sales data...
          </div>
        )}

        {error && (
          <div className="h-80 flex items-center justify-center text-red-500 text-sm">{error}</div>
        )}

        {!loading && !error && data && (
          <>
            {/* Map view */}
            {viewMode === "map" && (
              <div>
                {data.points.length === 0 ? (
                  <div className="h-80 flex items-center justify-center text-sand-400 text-sm">
                    No geo data for this period
                  </div>
                ) : (
                  <div className="h-[420px] rounded-lg overflow-hidden border border-sand-100">
                    <MapView points={data.points} />
                  </div>
                )}
                <p className="text-xs text-sand-400 mt-2">
                  {data.points.length} orders with location data
                </p>
              </div>
            )}

            {/* Sales reps view */}
            {viewMode === "reps" && (
              <div>
                {data.reps.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-sand-400 text-sm">
                    No tagged orders found. Add tags to orders to track sales reps.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-sand-100">
                          <th className="text-left py-2.5 text-xs text-sand-400 font-medium">Tag / Rep</th>
                          <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Orders</th>
                          <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Revenue</th>
                          <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.reps.slice(0, 20).map((rep) => {
                          const totalRev = data.reps.reduce((s, r) => s + r.revenue, 0);
                          const share = totalRev > 0 ? (rep.revenue / totalRev) * 100 : 0;
                          return (
                            <tr key={rep.tag} className="border-b border-sand-50">
                              <td className="py-2.5 font-medium text-sand-700">{rep.tag}</td>
                              <td className="py-2.5 text-right text-sand-500">{rep.orders}</td>
                              <td className="py-2.5 text-right font-medium text-sand-900">{fmt(rep.revenue, data.currency)}</td>
                              <td className="py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 h-1.5 bg-sand-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-sand-900 rounded-full" style={{ width: `${share}%` }} />
                                  </div>
                                  <span className="text-xs text-sand-400 w-10 text-right">{share.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Regions view */}
            {viewMode === "regions" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sand-100">
                      <th className="text-left py-2.5 text-xs text-sand-400 font-medium">Region</th>
                      <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Orders</th>
                      <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Revenue</th>
                      <th className="text-right py-2.5 text-xs text-sand-400 font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.regions.slice(0, 25).map((reg) => {
                      const totalRev = data.regions.reduce((s, r) => s + r.revenue, 0);
                      const share = totalRev > 0 ? (reg.revenue / totalRev) * 100 : 0;
                      return (
                        <tr key={reg.region} className="border-b border-sand-50">
                          <td className="py-2.5 font-medium text-sand-700">{reg.region}</td>
                          <td className="py-2.5 text-right text-sand-500">{reg.orders}</td>
                          <td className="py-2.5 text-right font-medium text-sand-900">{fmt(reg.revenue, data.currency)}</td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-sand-100 rounded-full overflow-hidden">
                                <div className="h-full bg-sand-900 rounded-full" style={{ width: `${share}%` }} />
                              </div>
                              <span className="text-xs text-sand-400 w-10 text-right">{share.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
