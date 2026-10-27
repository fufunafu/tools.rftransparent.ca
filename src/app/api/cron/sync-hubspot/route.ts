import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runCrmSync } from "@/lib/crm/sync";
import { getSupabase } from "@/lib/supabase";
import { SKIP_RUN_HISTORY_HEADER, withCronRun } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
async function handler(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.HUBSPOT_SYNC_ENABLED !== "true") return NextResponse.json({ skipped: "HubSpot sync is disabled." }, { headers: { [SKIP_RUN_HISTORY_HEADER]: "true" } });
  try {
    const state = await getSupabase().from("crm_sync_state").select("status,updated_at").eq("portal_id", process.env.HUBSPOT_PORTAL_ID ?? "").maybeSingle();
    if (state.error) throw new Error("Sync state unavailable");
    const restart = state.data?.status === "complete" && Date.now() - Date.parse(state.data.updated_at) > 24 * 60 * 60 * 1000;
    return NextResponse.json(await runCrmSync(restart));
  } catch { return NextResponse.json({ error: "HubSpot import paused. Saved pages are retained." }, { status: 503 }); }
}
export const GET = withCronRun("sync-hubspot", handler);
