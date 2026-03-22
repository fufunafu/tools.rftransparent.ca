import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import { getSupabase } from "@/lib/supabase";
import { getPipelineMetrics, getRepLeaderboard } from "@/lib/kpi-sales";

const VALID_DAYS = [30, 90, 180, 365, 730];

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customFrom = req.nextUrl.searchParams.get("from");
  const customTo = req.nextUrl.searchParams.get("to");
  const daysParam = parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);
  const days = VALID_DAYS.includes(daysParam) ? daysParam : 90;

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

  try {
    // Fetch pipeline data and employee names in parallel
    const [metrics, leaderboard, empResult] = await Promise.all([
      getPipelineMetrics(storeIds, fromDate),
      getRepLeaderboard(storeIds, fromDate),
      getSupabase()
        .from("employees")
        .select("name, shopify_tags")
        .eq("department", "sales")
        .eq("active", true),
    ]);

    console.log("[Pipeline Debug]", {
      storeIds,
      days,
      totalDrafts: metrics.totalDrafts,
      completedDrafts: metrics.completedDrafts,
      openDrafts: metrics.openDrafts,
      leaderboardRaw: leaderboard.length,
      employeesFound: empResult.data?.length ?? 0,
    });

    // Build tag → employee name map
    const tagToName = new Map<string, string>();
    if (empResult.data) {
      for (const emp of empResult.data) {
        const tags: string[] = emp.shopify_tags ?? [];
        for (const t of tags) {
          if (t) tagToName.set(t.toLowerCase(), emp.name);
        }
      }
    }

    // Enrich leaderboard with employee names, filter to known reps
    const enrichedLeaderboard = leaderboard
      .filter((r) => tagToName.has(r.repTag))
      .map((r) => ({
        ...r,
        repName: tagToName.get(r.repTag) ?? r.repTag,
      }));

    return NextResponse.json({
      metrics,
      leaderboard: enrichedLeaderboard,
      stores: allStores.map((s) => ({ id: s.id, label: s.label })),
      period: {
        from: fromDate.toISOString().split("T")[0],
        to: toDate.toISOString().split("T")[0],
        days,
      },
    });
  } catch (err) {
    console.error("[Pipeline API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch pipeline data" },
      { status: 500 },
    );
  }
}
