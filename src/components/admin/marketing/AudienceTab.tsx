"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

interface DeviceData {
  device: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

interface GeoData {
  criterionId: string;
  country: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
  shopify_revenue: number;
  shopify_orders: number;
}

interface RegionData {
  criterionId: string;
  region: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
  shopify_revenue: number;
  shopify_orders: number;
}

interface CityData {
  criterionId: string;
  city: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

interface AgeData {
  ageRange: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

interface GenderData {
  gender: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

interface LanguageData {
  language: string;
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n * 100) / 100);
}

const DEVICE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#a39e93"];
const AGE_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#94a3b8"];
const GENDER_COLORS = ["#2563eb", "#ec4899", "#94a3b8"];

type GeoSortKey = "region" | "ad_spend" | "revenue" | "roas" | "clicks" | "conversions";

export default function AudienceTab({
  from,
  to,
  demo,
  market = "all",
}: {
  from: string;
  to: string;
  demo: boolean;
  market?: string;
}) {
  const [devices, setDevices] = useState<DeviceData[]>([]);
  const [geo, setGeo] = useState<GeoData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Geo drill-down state
  const [selectedCountry, setSelectedCountry] = useState<GeoData | null>(null);
  const [regions, setRegions] = useState<RegionData[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [regionSort, setRegionSort] = useState<GeoSortKey>("ad_spend");
  const [regionSortAsc, setRegionSortAsc] = useState(false);

  const [selectedRegion, setSelectedRegion] = useState<RegionData | null>(null);
  const [cities, setCities] = useState<CityData[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);

  // Demographics state
  const [ageData, setAgeData] = useState<AgeData[]>([]);
  const [genderData, setGenderData] = useState<GenderData[]>([]);
  const [demoLoading, setDemoLoading] = useState(false);

  // Language state
  const [languages, setLanguages] = useState<LanguageData[]>([]);
  const [langLoading, setLangLoading] = useState(false);

  const demoParam = demo ? "&demo=true" : "";
  const marketParam = market !== "all" ? `&market=${market}` : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSelectedCountry(null);
    setSelectedRegion(null);

    Promise.all([
      fetch(`/api/marketing?view=devices&from=${from}&to=${to}${demoParam}${marketParam}`).then((r) => r.json()),
      fetch(`/api/marketing?view=geo&from=${from}&to=${to}${demoParam}${marketParam}`).then((r) => r.json()),
      fetch(`/api/marketing?view=demographics&from=${from}&to=${to}${demoParam}${marketParam}`).then((r) => r.json()),
      fetch(`/api/marketing?view=languages&from=${from}&to=${to}${demoParam}${marketParam}`).then((r) => r.json()),
    ])
      .then(([devJson, geoJson, demoJson, langJson]) => {
        if (cancelled) return;
        if (devJson.error) throw new Error(devJson.error);
        if (geoJson.error) throw new Error(geoJson.error);
        setDevices(devJson.devices ?? []);
        setGeo(geoJson.geo ?? []);
        setAgeData(demoJson.age ?? []);
        setGenderData(demoJson.gender ?? []);
        setLanguages(langJson.languages ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setDemoLoading(false);
          setLangLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [from, to, demo, market, demoParam, marketParam]);

  const loadRegions = useCallback((country: GeoData) => {
    setSelectedCountry(country);
    setSelectedRegion(null);
    setCities([]);
    setRegionsLoading(true);
    fetch(`/api/marketing?view=regions&from=${from}&to=${to}&country=${country.criterionId}${demoParam}${marketParam}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setRegions(json.regions ?? []);
      })
      .catch(() => {
        setRegions([]);
      })
      .finally(() => setRegionsLoading(false));
  }, [from, to, demoParam, marketParam]);

  const loadCities = useCallback((region: RegionData) => {
    setSelectedRegion(region);
    setCitiesLoading(true);
    const countryId = selectedCountry?.criterionId || "2840";
    fetch(`/api/marketing?view=cities&from=${from}&to=${to}&country=${countryId}${demoParam}${marketParam}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setCities(json.cities ?? []);
      })
      .catch(() => setCities([]))
      .finally(() => setCitiesLoading(false));
  }, [from, to, demoParam, marketParam, selectedCountry]);

  const handleRegionSort = (key: GeoSortKey) => {
    if (regionSort === key) setRegionSortAsc(!regionSortAsc);
    else { setRegionSort(key); setRegionSortAsc(false); }
  };

  const sortedRegions = [...regions].sort((a, b) => {
    const aVal = regionSort === "region" ? a.region : a[regionSort];
    const bVal = regionSort === "region" ? b.region : b[regionSort];
    if (typeof aVal === "string" && typeof bVal === "string")
      return regionSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    return regionSortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  if (loading) return <div className="text-center py-12 text-sand-400">Loading audience data...</div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>;

  const tooltipStyle = {
    contentStyle: { background: "#faf9f7", border: "1px solid #e5e0d8", borderRadius: "8px", fontSize: "12px" },
  };

  const totalSpend = devices.reduce((s, d) => s + d.ad_spend, 0);
  const SortIcon = ({ active, asc }: { active: boolean; asc: boolean }) => (
    <span className={`ml-0.5 text-[10px] ${active ? "text-sand-900" : "text-sand-300"}`}>
      {active ? (asc ? "\u2191" : "\u2193") : "\u2195"}
    </span>
  );

  return (
    <div className="space-y-6">
      {/* Device Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-sand-200/60 p-5">
          <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Spend by Device</p>
          <div className="h-64">
            {devices.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={devices}
                    dataKey="ad_spend"
                    nameKey="device"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(props) =>
                      `${props.name ?? ""} ${((props.percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {devices.map((_, i) => (
                      <Cell key={i} fill={DEVICE_COLORS[i % DEVICE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: unknown) => [formatCurrency(Number(value)), "Spend"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-sand-400 text-sm">No device data</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-sand-200/60 p-5">
          <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Device Performance</p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-sand-100">
                <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">Device</th>
                <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Share</th>
                <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-50">
              {devices.map((d, i) => (
                <tr key={d.device}>
                  <td className="py-2.5 text-sm text-sand-900 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full inline-block"
                      style={{ backgroundColor: DEVICE_COLORS[i % DEVICE_COLORS.length] }}
                    />
                    {d.device}
                  </td>
                  <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(d.ad_spend)}</td>
                  <td className="py-2.5 text-sm text-sand-500 text-right">
                    {totalSpend > 0 ? ((d.ad_spend / totalSpend) * 100).toFixed(1) : 0}%
                  </td>
                  <td className="py-2.5 text-sm text-sand-700 text-right">{d.roas}x</td>
                  <td className="py-2.5 text-sm text-sand-700 text-right">{formatNumber(d.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Geographic Performance with Drill-Down */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 mb-4">
          <button
            onClick={() => { setSelectedCountry(null); setSelectedRegion(null); }}
            className={`text-xs uppercase tracking-wider ${selectedCountry ? "text-sand-400 hover:text-sand-600 cursor-pointer" : "text-sand-400 font-medium"}`}
          >
            Countries
          </button>
          {selectedCountry && (
            <>
              <span className="text-sand-300 text-xs">/</span>
              <button
                onClick={() => setSelectedRegion(null)}
                className={`text-xs uppercase tracking-wider ${selectedRegion ? "text-sand-400 hover:text-sand-600 cursor-pointer" : "text-sand-400 font-medium"}`}
              >
                {selectedCountry.country}
              </button>
            </>
          )}
          {selectedRegion && (
            <>
              <span className="text-sand-300 text-xs">/</span>
              <span className="text-xs uppercase tracking-wider text-sand-400 font-medium">
                {selectedRegion.region}
              </span>
            </>
          )}
        </div>

        {/* Level 1: Countries */}
        {!selectedCountry && (
          geo.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={geo.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11, fill: "#a39e93" }} width={120} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: unknown, name: unknown) => [
                        formatCurrency(Number(value)),
                        name === "shopify_revenue" ? "Shopify Revenue" : name === "revenue" ? "Ad Revenue" : "Spend",
                      ]}
                    />
                    <Bar dataKey="shopify_revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="revenue" fill="#2563eb" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="ad_spend" fill="#dc2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-sand-100">
                      <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">Country</th>
                      <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                      <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Shopify Rev.</th>
                      <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Orders</th>
                      <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Ad Rev.</th>
                      <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-50">
                    {geo.slice(0, 10).map((g) => (
                      <tr
                        key={g.criterionId}
                        className="cursor-pointer hover:bg-sand-50 transition-colors"
                        onClick={() => loadRegions(g)}
                      >
                        <td className="py-2.5 text-sm text-sand-900 flex items-center gap-1.5">
                          {g.country}
                          <span className="text-sand-300 text-xs">&rarr;</span>
                        </td>
                        <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(g.ad_spend)}</td>
                        <td className="py-2.5 text-sm font-medium text-sand-900 text-right">{formatCurrency(g.shopify_revenue)}</td>
                        <td className="py-2.5 text-sm text-sand-500 text-right">{formatNumber(g.shopify_orders)}</td>
                        <td className="py-2.5 text-sm text-sand-500 text-right">{formatCurrency(g.revenue)}</td>
                        <td className="py-2.5 text-sm text-sand-700 text-right">{g.roas}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-sand-400 text-sm">No geographic data available.</div>
          )
        )}

        {/* Level 2: Country selected → show stats + regions */}
        {selectedCountry && !selectedRegion && (
          <div className="space-y-5">
            {/* Country summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Ad Spend", value: formatCurrency(selectedCountry.ad_spend) },
                { label: "Shopify Revenue", value: formatCurrency(selectedCountry.shopify_revenue) },
                { label: "Orders", value: formatNumber(selectedCountry.shopify_orders) },
                { label: "Ad Revenue", value: formatCurrency(selectedCountry.revenue) },
                { label: "ROAS", value: `${selectedCountry.roas}x` },
              ].map((s) => (
                <div key={s.label} className="bg-sand-50 rounded-lg px-4 py-3">
                  <p className="text-[10px] text-sand-400 uppercase tracking-wider">{s.label}</p>
                  <p className="text-lg font-semibold text-sand-900 mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Top States/Provinces */}
            <div>
              <p className="text-xs text-sand-400 uppercase tracking-wider mb-3">
                Top {selectedCountry.criterionId === "2124" ? "Provinces" : "States"}
              </p>
              {regionsLoading ? (
                <div className="text-center py-6 text-sand-400 text-sm">Loading regions...</div>
              ) : sortedRegions.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sortedRegions.slice(0, 10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v) => `$${v}`} />
                        <YAxis type="category" dataKey="region" tick={{ fontSize: 11, fill: "#a39e93" }} width={120} />
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: unknown, name: unknown) => [
                            formatCurrency(Number(value)),
                            name === "shopify_revenue" ? "Shopify Revenue" : name === "revenue" ? "Ad Revenue" : "Spend",
                          ]}
                        />
                        <Bar dataKey="shopify_revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="revenue" fill="#2563eb" radius={[0, 4, 4, 0]} />
                        <Bar dataKey="ad_spend" fill="#dc2626" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-sand-100">
                          <th onClick={() => handleRegionSort("region")} className="pb-2 text-left text-xs font-medium text-sand-500 uppercase cursor-pointer hover:text-sand-700">
                            Region<SortIcon active={regionSort === "region"} asc={regionSortAsc} />
                          </th>
                          <th onClick={() => handleRegionSort("ad_spend")} className="pb-2 text-right text-xs font-medium text-sand-500 uppercase cursor-pointer hover:text-sand-700">
                            Spend<SortIcon active={regionSort === "ad_spend"} asc={regionSortAsc} />
                          </th>
                          <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Shopify Rev.</th>
                          <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Orders</th>
                          <th onClick={() => handleRegionSort("revenue")} className="pb-2 text-right text-xs font-medium text-sand-500 uppercase cursor-pointer hover:text-sand-700">
                            Ad Rev.<SortIcon active={regionSort === "revenue"} asc={regionSortAsc} />
                          </th>
                          <th onClick={() => handleRegionSort("roas")} className="pb-2 text-right text-xs font-medium text-sand-500 uppercase cursor-pointer hover:text-sand-700">
                            ROAS<SortIcon active={regionSort === "roas"} asc={regionSortAsc} />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sand-50">
                        {sortedRegions.map((r) => (
                          <tr
                            key={r.criterionId}
                            className="cursor-pointer hover:bg-sand-50 transition-colors"
                            onClick={() => loadCities(r)}
                          >
                            <td className="py-2.5 text-sm text-sand-900 flex items-center gap-1.5">
                              {r.region}
                              <span className="text-sand-300 text-xs">&rarr;</span>
                            </td>
                            <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(r.ad_spend)}</td>
                            <td className="py-2.5 text-sm font-medium text-sand-900 text-right">{formatCurrency(r.shopify_revenue)}</td>
                            <td className="py-2.5 text-sm text-sand-500 text-right">{formatNumber(r.shopify_orders)}</td>
                            <td className="py-2.5 text-sm text-sand-500 text-right">{formatCurrency(r.revenue)}</td>
                            <td className="py-2.5 text-sm text-sand-700 text-right">{r.roas}x</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-sand-400 text-sm text-center">No region data available for this country.</div>
              )}
            </div>
          </div>
        )}

        {/* Level 3: Region selected → show region stats + top cities */}
        {selectedCountry && selectedRegion && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Spend", value: formatCurrency(selectedRegion.ad_spend) },
                { label: "Revenue", value: formatCurrency(selectedRegion.revenue) },
                { label: "ROAS", value: `${selectedRegion.roas}x` },
                { label: "Clicks", value: formatNumber(selectedRegion.clicks) },
              ].map((s) => (
                <div key={s.label} className="bg-sand-50 rounded-lg px-4 py-3">
                  <p className="text-[10px] text-sand-400 uppercase tracking-wider">{s.label}</p>
                  <p className="text-lg font-semibold text-sand-900 mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs text-sand-400 uppercase tracking-wider mb-3">Top Cities</p>
              {citiesLoading ? (
                <div className="text-center py-6 text-sand-400 text-sm">Loading cities...</div>
              ) : cities.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-sand-100">
                        <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">City</th>
                        <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                        <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Revenue</th>
                        <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                        <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Clicks</th>
                        <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Conv.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand-50">
                      {cities.map((c) => (
                        <tr key={c.criterionId}>
                          <td className="py-2.5 text-sm text-sand-900">{c.city}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(c.ad_spend)}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(c.revenue)}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{c.roas}x</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{formatNumber(c.clicks)}</td>
                          <td className="py-2.5 text-sm text-sand-700 text-right">{formatNumber(c.conversions)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-6 text-sand-400 text-sm">No city data available for this region.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Demographics: Age + Gender */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Age Distribution */}
        <div className="bg-white rounded-xl border border-sand-200/60 p-5">
          <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Age Distribution</p>
          {demoLoading ? (
            <div className="text-center py-8 text-sand-400 text-sm">Loading...</div>
          ) : ageData.length > 0 ? (
            <>
              <div className="h-52 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ageData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
                    <XAxis dataKey="ageRange" tick={{ fontSize: 11, fill: "#a39e93" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#a39e93" }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: unknown, name: unknown) => [
                        formatCurrency(Number(value)),
                        name === "revenue" ? "Revenue" : "Spend",
                      ]}
                    />
                    <Bar dataKey="revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ad_spend" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-sand-100">
                    <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">Age</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Revenue</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-50">
                  {ageData.map((a, i) => (
                    <tr key={a.ageRange}>
                      <td className="py-2 text-sm text-sand-900 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: AGE_COLORS[i % AGE_COLORS.length] }} />
                        {a.ageRange}
                      </td>
                      <td className="py-2 text-sm text-sand-700 text-right">{formatCurrency(a.ad_spend)}</td>
                      <td className="py-2 text-sm text-sand-700 text-right">{formatCurrency(a.revenue)}</td>
                      <td className="py-2 text-sm text-sand-700 text-right">{a.roas}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-center py-8 text-sand-400 text-sm">No age data available.</div>
          )}
        </div>

        {/* Gender Distribution */}
        <div className="bg-white rounded-xl border border-sand-200/60 p-5">
          <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Gender Distribution</p>
          {demoLoading ? (
            <div className="text-center py-8 text-sand-400 text-sm">Loading...</div>
          ) : genderData.length > 0 ? (
            <>
              <div className="h-52 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderData}
                      dataKey="ad_spend"
                      nameKey="gender"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(props) =>
                        `${props.name ?? ""} ${((props.percent ?? 0) * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                    >
                      {genderData.map((_, i) => (
                        <Cell key={i} fill={GENDER_COLORS[i % GENDER_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: unknown) => [formatCurrency(Number(value)), "Spend"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-sand-100">
                    <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">Gender</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Revenue</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                    <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Conv.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-50">
                  {genderData.map((g, i) => (
                    <tr key={g.gender}>
                      <td className="py-2 text-sm text-sand-900 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: GENDER_COLORS[i % GENDER_COLORS.length] }} />
                        {g.gender}
                      </td>
                      <td className="py-2 text-sm text-sand-700 text-right">{formatCurrency(g.ad_spend)}</td>
                      <td className="py-2 text-sm text-sand-700 text-right">{formatCurrency(g.revenue)}</td>
                      <td className="py-2 text-sm text-sand-700 text-right">{g.roas}x</td>
                      <td className="py-2 text-sm text-sand-700 text-right">{formatNumber(g.conversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-center py-8 text-sand-400 text-sm">No gender data available.</div>
          )}
        </div>
      </div>

      {/* Language Performance */}
      <div className="bg-white rounded-xl border border-sand-200/60 p-5">
        <p className="text-xs text-sand-400 uppercase tracking-wider mb-4">Language Performance</p>
        {langLoading ? (
          <div className="text-center py-6 text-sand-400 text-sm">Loading...</div>
        ) : languages.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-sand-100">
                  <th className="pb-2 text-left text-xs font-medium text-sand-500 uppercase">Language</th>
                  <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Spend</th>
                  <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Revenue</th>
                  <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">ROAS</th>
                  <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Clicks</th>
                  <th className="pb-2 text-right text-xs font-medium text-sand-500 uppercase">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-50">
                {languages.map((l) => (
                  <tr key={l.language}>
                    <td className="py-2.5 text-sm text-sand-900">{l.language}</td>
                    <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(l.ad_spend)}</td>
                    <td className="py-2.5 text-sm text-sand-700 text-right">{formatCurrency(l.revenue)}</td>
                    <td className="py-2.5 text-sm text-sand-700 text-right">{l.roas}x</td>
                    <td className="py-2.5 text-sm text-sand-700 text-right">{formatNumber(l.clicks)}</td>
                    <td className="py-2.5 text-sm text-sand-700 text-right">{formatNumber(l.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-sand-400 text-sm">No language data available.</div>
        )}
      </div>
    </div>
  );
}
