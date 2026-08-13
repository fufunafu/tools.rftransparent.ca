import { after, NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import { getSupabase } from "@/lib/supabase";
import { getPipelineDashboardData } from "@/lib/kpi-sales";
import {
  loadPipelineMirror,
  pipelineMirrorHistoryStart,
  syncPipelineShopifyMirror,
} from "@/lib/pipeline-shopify-mirror";

const VALID_DAYS = [30, 90, 180, 365, 730];
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface PipelineRefreshParams {
  cacheKey: string;
  storeIds: string[];
  fromDate: Date;
  toDate: Date;
  days: number;
  forceMirrorSync?: boolean;
}

async function computeAndCachePipeline({
  cacheKey,
  storeIds,
  fromDate,
  toDate,
  days,
  forceMirrorSync,
}: PipelineRefreshParams) {
  const empResult = await getSupabase()
    .from("employees")
    .select("name, shopify_tags")
    .eq("department", "sales")
    .eq("active", true);

  const tagToName = new Map<string, string>();
  const knownRepTags: string[] = [];
  if (empResult.data) {
    for (const emp of empResult.data) {
      for (const t of (emp.shopify_tags ?? []) as string[]) {
        if (t) {
          const lower = t.toLowerCase();
          tagToName.set(lower, emp.name);
          knownRepTags.push(lower);
        }
      }
    }
  }

  const mirrorFrom = pipelineMirrorHistoryStart(fromDate);
  let mirroredSource = null;
  try {
    await syncPipelineShopifyMirror(mirrorFrom, { force: forceMirrorSync });
    mirroredSource = await loadPipelineMirror(storeIds, mirrorFrom);
  } catch (err) {
    console.warn("[Pipeline API] Shopify mirror unavailable, using direct fetch", err);
  }
  const { metrics, leaderboard, warnings, prediction, channelMetrics } =
    await getPipelineDashboardData(
      storeIds,
      fromDate,
      toDate,
      knownRepTags,
      mirroredSource ?? undefined,
    );

  const enrichedLeaderboard = leaderboard.map((rep) => ({
    ...rep,
    repName: tagToName.get(rep.repTag) ?? rep.repTag,
  }));
  const enrichedChannelMetrics = {
    ...channelMetrics,
    employeeBreakdown: channelMetrics.employeeBreakdown.map((employee) => ({
      ...employee,
      repName: tagToName.get(employee.repTag) ?? employee.repTag,
    })),
  };

  const computedAt = new Date().toISOString();
  const result = {
    metrics,
    prediction,
    channelMetrics: enrichedChannelMetrics,
    leaderboard: enrichedLeaderboard,
    period: {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
      days,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  await getSupabase()
    .from("pipeline_cache")
    .upsert({
      cache_key: cacheKey,
      result,
      computed_at: computedAt,
    });

  return { result, computedAt };
}

const inFlightRefreshes = new Map<
  string,
  ReturnType<typeof computeAndCachePipeline>
>();

function refreshPipeline(params: PipelineRefreshParams) {
  const existing = inFlightRefreshes.get(params.cacheKey);
  if (existing) return existing;

  const refresh = computeAndCachePipeline(params);
  inFlightRefreshes.set(params.cacheKey, refresh);
  refresh.then(
    () => {
      if (inFlightRefreshes.get(params.cacheKey) === refresh)
        inFlightRefreshes.delete(params.cacheKey);
    },
    () => {
      if (inFlightRefreshes.get(params.cacheKey) === refresh)
        inFlightRefreshes.delete(params.cacheKey);
    },
  );
  return refresh;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customFrom = req.nextUrl.searchParams.get("from");
  const customTo = req.nextUrl.searchParams.get("to");
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);
  const days = VALID_DAYS.includes(daysParam) ? daysParam : 90;
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";

  let fromDate: Date;
  let toDate: Date;
  if (customFrom && customTo && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    fromDate = new Date(customFrom + "T00:00:00");
    toDate = new Date(customTo + "T23:59:59");
  } else {
    toDate = new Date();
    fromDate = new Date(toDate);
    fromDate.setDate(fromDate.getDate() - days);
  }

  const allStores = getStores();
  const storeParam = req.nextUrl.searchParams.get("store");
  const storeIds = storeParam && storeParam !== "all"
    ? allStores.filter((s) => s.id === storeParam).map((s) => s.id)
    : allStores.map((s) => s.id);

  if (storeIds.length === 0)
    return NextResponse.json({ error: "No stores configured" }, { status: 503 });

  // Cache key based on store filter + date range
  const cacheKey = `pipeline:${[...storeIds].sort().join(",")}:${days}:${customFrom ?? ""}:${customTo ?? ""}`;
  const stores = allStores.map((configuredStore) => ({
    id: configuredStore.id,
    label: configuredStore.label,
  }));
  const refreshParams = {
    cacheKey,
    storeIds,
    fromDate,
    toDate,
    days,
    forceMirrorSync: forceRefresh,
  };

  try {
    if (!forceRefresh) {
      const { data: cached } = await getSupabase()
        .from("pipeline_cache")
        .select("result, computed_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      if (cached) {
        const age = Date.now() - new Date(cached.computed_at).getTime();
        if (age < CACHE_TTL_MS) {
          return NextResponse.json({
            ...cached.result,
            cachedAt: cached.computed_at,
            stores,
          }, { headers: { "X-Pipeline-Cache": "hit" } });
        }

        // Keep expired data usable while the expensive refresh runs after the response.
        after(async () => {
          try {
            await refreshPipeline(refreshParams);
          } catch (err) {
            console.error("[Pipeline API] Background refresh failed", err);
          }
        });
        return NextResponse.json({
          ...cached.result,
          cachedAt: cached.computed_at,
          stores,
        }, { headers: { "X-Pipeline-Cache": "stale" } });
      }
    }

    const { result, computedAt } = await refreshPipeline(refreshParams);

    return NextResponse.json({
      ...result,
      cachedAt: computedAt,
      stores,
    }, { headers: { "X-Pipeline-Cache": forceRefresh ? "refresh" : "miss" } });
  } catch (err) {
    console.error("[Pipeline API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch pipeline data" },
      { status: 500 },
    );
  }
}
