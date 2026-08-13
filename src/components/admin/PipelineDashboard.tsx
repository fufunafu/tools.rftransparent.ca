"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import PipelineOverviewView from "./PipelineOverviewView";
import PipelineForecastView from "./PipelineForecastView";
import PipelineTeamView from "./PipelineTeamView";
import { StatusPill } from "./PipelineDashboardPrimitives";
import type { PipelineData } from "./PipelineDashboard.types";
import type { PipelineView } from "@/lib/pipeline-dashboard-view";
import {
  getPipelineDisplayState,
} from "@/lib/pipeline-dashboard-view";
import {
  pipelineCacheLoad,
  pipelineCacheSave,
  PIPELINE_CACHE_MAX_STALE_MS,
  PIPELINE_CACHE_TTL_MS,
} from "@/lib/pipeline-cache";

export type { PipelineData } from "./PipelineDashboard.types";

const DAY_OPTIONS = [30, 90, 180, 365, 730] as const;
const DAY_LABELS: Record<number, string> = {
  30: "30d",
  90: "90d",
  180: "6mo",
  365: "1yr",
  730: "2yr",
};

const TABS: Array<{ id: PipelineView; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Pipeline health and risks" },
  { id: "forecast", label: "Forecast", description: "Revenue outlook and assumptions" },
  { id: "team", label: "Team", description: "Rep performance and attribution" },
];

const pipelineCache = new Map<string, { data: PipelineData; ts: number }>();

export default function PipelineDashboard({
  initialData,
  initialView = "overview",
}: {
  initialData?: PipelineData;
  initialView?: PipelineView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeView, setActiveView] = useState<PipelineView>(initialView);
  const [days, setDays] = useState(90);
  const [store, setStore] = useState("all");
  const [useCustom, setUseCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 90);
    return date.toISOString().split("T")[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData] = useState<PipelineData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");
  const [loadStep, setLoadStep] = useState("");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dataRef = useRef<PipelineData | null>(initialData ?? null);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === initialView) return;
    params.set("view", initialView);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [initialView, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const params = buildDataParams({ store, days, useCustom, customFrom, customTo });
    const cacheKey = params.toString();
    let cached = pipelineCache.get(cacheKey);

    setError("");

    if (!cached && initialData && cacheKey === "store=all&days=90") {
      const timestamp = pipelineCacheSave(cacheKey, initialData);
      cached = { data: initialData, ts: timestamp };
      pipelineCache.set(cacheKey, cached);
    }
    if (cached && Date.now() - cached.ts > PIPELINE_CACHE_MAX_STALE_MS) {
      pipelineCache.delete(cacheKey);
      cached = undefined;
    }
    if (!cached) {
      const persisted = pipelineCacheLoad<PipelineData>(cacheKey);
      if (persisted) {
        cached = { data: persisted.data, ts: persisted.ts };
        pipelineCache.set(cacheKey, cached);
      }
    }

    const cacheAge = cached ? Date.now() - cached.ts : Number.POSITIVE_INFINITY;
    const hasVisibleData = Boolean(cached || dataRef.current);
    if (cached) {
      setData(cached.data);
      setLoading(false);
      if (cacheAge <= PIPELINE_CACHE_TTL_MS) {
        setRefreshing(false);
        return;
      }
    }

    setLoading(!hasVisibleData);
    setRefreshing(hasVisibleData);
    setLoadStep(hasVisibleData ? "" : "Connecting to Shopify...");

    const stepTimer = hasVisibleData
      ? undefined
      : setTimeout(() => {
          if (!cancelled) setLoadStep("Fetching quotes and calculating the pipeline...");
        }, 3000);

    const fetchPipeline = async (retryCount = 0) => {
      try {
        const response = await fetch(`/api/shopify/pipeline?${params.toString()}`);
        const cacheStatus = response.headers.get("X-Pipeline-Cache");
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Pipeline data could not be loaded");
        }

        const nextData = payload as PipelineData;
        setData(nextData);
        const timestamp = pipelineCacheSave(cacheKey, nextData);
        pipelineCache.set(cacheKey, { data: nextData, ts: timestamp });

        if (cacheStatus === "stale" && retryCount < 2) {
          setRefreshing(true);
          retryTimer = setTimeout(() => {
            void fetchPipeline(retryCount + 1);
          }, 12_000);
        } else {
          setRefreshing(false);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Pipeline data could not be loaded");
          setRefreshing(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadStep("");
        }
      }
    };

    void fetchPipeline();

    return () => {
      cancelled = true;
      if (stepTimer) clearTimeout(stepTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [customFrom, customTo, days, initialData, store, useCustom]);

  const recalculate = async () => {
    setRecalculating(true);
    setRefreshing(Boolean(data));
    setError("");
    try {
      const cacheParams = buildDataParams({ store, days, useCustom, customFrom, customTo });
      const cacheKey = cacheParams.toString();
      const fetchParams = new URLSearchParams(cacheParams);
      fetchParams.set("refresh", "true");
      const response = await fetch(`/api/shopify/pipeline?${fetchParams.toString()}`);
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Pipeline recalculation failed");
      }
      const nextData = payload as PipelineData;
      setData(nextData);
      const timestamp = pipelineCacheSave(cacheKey, nextData);
      pipelineCache.set(cacheKey, { data: nextData, ts: timestamp });
    } catch (recalculationError) {
      setError(
        recalculationError instanceof Error
          ? recalculationError.message
          : "Pipeline recalculation failed",
      );
    } finally {
      setRecalculating(false);
      setRefreshing(false);
    }
  };

  const selectView = (nextView: PipelineView) => {
    setActiveView(nextView);
    const params = new URLSearchParams(window.location.search);
    params.set("view", nextView);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextView = TABS[nextIndex].id;
    selectView(nextView);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  const stores = data?.stores ?? initialData?.stores ?? [];
  const isEmpty = Boolean(
    data &&
      data.metrics.totalDrafts === 0 &&
      data.channelMetrics.totalOrders === 0 &&
      (data.leaderboard ?? []).length === 0,
  );
  const isPartial = Boolean(
    data &&
      [
        data.metrics.monthlyTrend,
        data.prediction.monthlyForecasts,
        data.prediction.buckets,
        data.prediction.seasonalPattern,
        data.leaderboard,
        data.channelMetrics.employeeBreakdown,
      ].some((section) => !Array.isArray(section)),
  );
  const displayState = getPipelineDisplayState({
    hasData: Boolean(data),
    isEmpty,
    isPartial,
    loading,
    refreshing: refreshing || recalculating,
    error,
    cachedAt: data?.cachedAt,
  });

  return (
    <div className="space-y-6 pb-10">
      <header className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Sales management</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Sales pipeline</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Understand pipeline health first, then explore the forecast and team performance.
            </p>
          </div>
          <RefreshStatus
            state={displayState}
            cachedAt={data?.cachedAt}
            onRecalculate={recalculate}
            recalculating={recalculating}
          />
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(180px,0.7fr)_minmax(0,2fr)] xl:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Store</span>
              <select
                aria-label="Store"
                value={store}
                onChange={(event) => setStore(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All stores</option>
                {stores.map((storeOption) => (
                  <option key={storeOption.id} value={storeOption.id}>{storeOption.label}</option>
                ))}
              </select>
            </label>

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Date range</legend>
              <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
                  {DAY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={!useCustom && days === option}
                      onClick={() => {
                        setDays(option);
                        setUseCustom(false);
                      }}
                      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        !useCustom && days === option
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {DAY_LABELS[option]}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={useCustom}
                    onClick={() => setUseCustom(true)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                      useCustom
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {useCustom && (
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <label>
                      <span className="sr-only">Start date</span>
                      <input
                        type="date"
                        aria-label="Start date"
                        value={customFrom}
                        max={customTo}
                        onChange={(event) => setCustomFrom(event.target.value)}
                        className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <span className="text-xs text-slate-400">to</span>
                    <label>
                      <span className="sr-only">End date</span>
                      <input
                        type="date"
                        aria-label="End date"
                        value={customTo}
                        min={customFrom}
                        onChange={(event) => setCustomTo(event.target.value)}
                        className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                  </div>
                )}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="max-w-full overflow-x-auto border-b border-slate-200">
          <div role="tablist" aria-label="Pipeline views" className="grid min-w-[540px] grid-cols-3 gap-1">
            {TABS.map((tab, index) => {
              const selected = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={`pipeline-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`pipeline-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectView(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`border-b-2 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 ${
                    selected
                      ? "border-blue-600 bg-blue-50/50 text-blue-800"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  }`}
                >
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span className="mt-0.5 block text-xs font-normal opacity-75">{tab.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {error && data && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The latest update failed. Saved results remain visible. {error}
        </div>
      )}

      {displayState === "partial" && data && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some pipeline sections are unavailable. Available metrics remain visible while the next refresh completes.
        </div>
      )}

      {loading && !data && <PipelineLoading label={loadStep || "Loading pipeline data..."} />}

      {error && !data && !loading && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-6 text-red-800">
          <p className="font-semibold">Pipeline data could not be loaded</p>
          <p className="mt-1 text-sm">{error}</p>
          <button type="button" onClick={() => void recalculate()} className="mt-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800">
            Try again
          </button>
        </div>
      )}

      {data && (
        <div
          id={`pipeline-panel-${activeView}`}
          role="tabpanel"
          aria-labelledby={`pipeline-tab-${activeView}`}
          tabIndex={0}
          className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
        >
          {isEmpty && (
            <div className="mb-6 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
              No pipeline activity was found for these filters. The dashboard remains available so you can review each section or change the date range.
            </div>
          )}
          {activeView === "overview" && <PipelineOverviewView data={data} />}
          {activeView === "forecast" && (
            <PipelineForecastView data={data} storeId={store} onRecalculate={recalculate} />
          )}
          {activeView === "team" && <PipelineTeamView data={data} />}
        </div>
      )}
    </div>
  );
}

function buildDataParams({
  store,
  days,
  useCustom,
  customFrom,
  customTo,
}: {
  store: string;
  days: number;
  useCustom: boolean;
  customFrom: string;
  customTo: string;
}) {
  const params = new URLSearchParams({ store });
  if (useCustom) {
    params.set("from", customFrom);
    params.set("to", customTo);
  } else {
    params.set("days", String(days));
  }
  return params;
}

function formatCacheAge(cachedAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(cachedAt).getTime()) / 60_000));
  if (minutes < 1) return "Computed just now";
  if (minutes < 60) return `Computed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Computed ${hours}h ${minutes % 60}m ago`;
}

function RefreshStatus({
  state,
  cachedAt,
  onRecalculate,
  recalculating,
}: {
  state: ReturnType<typeof getPipelineDisplayState>;
  cachedAt?: string;
  onRecalculate: () => Promise<void>;
  recalculating: boolean;
}) {
  const status = {
    loading: { tone: "blue" as const, label: "Loading" },
    error: { tone: "red" as const, label: "Unavailable" },
    empty: { tone: "slate" as const, label: "No activity" },
    partial: { tone: "amber" as const, label: "Partial data" },
    ready: { tone: "green" as const, label: "Current" },
    cached: { tone: "slate" as const, label: "Saved data" },
    refreshing: { tone: "blue" as const, label: "Updating" },
    stale: { tone: "amber" as const, label: "Saved data" },
  }[state];

  return (
    <div className="flex flex-wrap items-center gap-3 lg:justify-end">
      <div className="text-right">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {cachedAt && (
          <p suppressHydrationWarning className="mt-1 text-[11px] text-slate-400">
            {formatCacheAge(cachedAt)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onRecalculate()}
        disabled={recalculating}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50"
      >
        {recalculating ? "Recalculating..." : "Recalculate"}
      </button>
    </div>
  );
}

function PipelineLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-slate-200/70">
      <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full w-2/3 rounded-full bg-blue-600 motion-safe:animate-pulse" />
      </div>
      <p className="mt-3 text-sm text-slate-500">{label}</p>
    </div>
  );
}
