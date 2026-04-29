import { NextRequest, NextResponse } from "next/server";
import { getStores } from "@/lib/shopify";
import { syncDraftOrdersForStore } from "@/lib/followup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stores = getStores();
  const results: { store_id: string; label: string; status: string; detail?: string }[] = [];

  for (const store of stores) {
    try {
      const r = await syncDraftOrdersForStore(store.id);
      results.push({
        store_id: store.id,
        label: store.label,
        status: "ok",
        detail: `new ${r.new_leads}, updated ${r.updated_leads}, auto_won ${r.auto_won}, stale ${r.stale_detected}`,
      });
    } catch (err) {
      results.push({
        store_id: store.id,
        label: store.label,
        status: "error",
        detail: err instanceof Error ? err.message : "sync failed",
      });
    }
  }

  console.log("[Cron sync-followup]", JSON.stringify(results));
  return NextResponse.json({ results, synced_at: new Date().toISOString() });
}
