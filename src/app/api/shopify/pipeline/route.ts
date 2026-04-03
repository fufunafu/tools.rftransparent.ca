import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import { getSupabase } from "@/lib/supabase";
import { getFullPipelineData, getPipelinePrediction, getOrderChannelMetrics } from "@/lib/kpi-sales";

const VALID_DAYS = [30, 90, 180, 365, 730];
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
  const cacheKey = `pipeline:${storeIds.sort().join(",")}:${days}:${customFrom ?? ""}:${customTo ?? ""}`;

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const { data: cached } = await getSupabase()
        .from("pipeline_cache")
        .select("result, computed_at")
        .eq("cache_key", cacheKey)
        .single();

      if (cached) {
        const age = Date.now() - new Date(cached.computed_at).getTime();
        if (age < CACHE_TTL_MS) {
          return NextResponse.json({
            ...cached.result,
            cachedAt: cached.computed_at,
            stores: allStores.map((s) => ({ id: s.id, label: s.label })),
          });
        }
      }
    }

    // Fetch employee tags first (fast Supabase query)
    const empResult = await getSupabase()
      .from("employees")
      .select("name, shopify_tags")
      .eq("department", "sales")
      .eq("active", true);

    // Build tag → employee name map and known rep tags list
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

    // Metrics + prediction + channel split in parallel
    const [{ metrics, leaderboard, warnings }, prediction, channelMetrics] = await Promise.all([
      getFullPipelineData(storeIds, fromDate, toDate, knownRepTags),
      getPipelinePrediction(storeIds),
      getOrderChannelMetrics(storeIds, fromDate, toDate, knownRepTags),
    ]);

    // Enrich leaderboard with employee names
    const enrichedLeaderboard = leaderboard.map((r) => ({
      ...r,
      repName: tagToName.get(r.repTag) ?? r.repTag,
    }));

    // Enrich channel employee breakdown with names
    const enrichedChannelMetrics = {
      ...channelMetrics,
      employeeBreakdown: channelMetrics.employeeBreakdown.map((e) => ({
        ...e,
        repName: tagToName.get(e.repTag) ?? e.repTag,
      })),
    };

    const now = new Date().toISOString();
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

    // Write to cache (upsert)
    await getSupabase()
      .from("pipeline_cache")
      .upsert({
        cache_key: cacheKey,
        result,
        computed_at: now,
      });

    return NextResponse.json({
      ...result,
      cachedAt: now,
      stores: allStores.map((s) => ({ id: s.id, label: s.label })),
    });
  } catch (err) {
    console.error("[Pipeline API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch pipeline data" },
      { status: 500 },
    );
  }
}
