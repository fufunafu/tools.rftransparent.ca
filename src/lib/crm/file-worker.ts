import "server-only";
import { getSupabase } from "@/lib/supabase";
import { migrateCrmAssets } from "./assets.mjs";

const LEASE_KEY = "crm:files:copy-lease";
export async function runCrmFileWorker() {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return { skipped: "HubSpot file access is not configured." };
  const db = getSupabase();
  const owner = crypto.randomUUID();
  const start = Date.now();
  const expired = await db.from("api_cache").delete().eq("cache_key", LEASE_KEY).lt("computed_at", new Date(start - 10 * 60000).toISOString());
  if (expired.error) throw new Error("CRM file worker lease unavailable");
  const claimed = await db.from("api_cache").insert({ cache_key: LEASE_KEY, result: { owner }, computed_at: new Date(start).toISOString() });
  if (claimed.error?.code === "23505") return { skipped: "A CRM file copy is already running." };
  if (claimed.error) throw new Error("CRM file worker lease unavailable");
  try {
    const results = await Promise.allSettled([migrateCrmAssets(db, process.env.HUBSPOT_ACCESS_TOKEN, { budgetMs: 180000, limit: 100 })]);
    const totals = { copied: 0, blocked: 0, failed: 0, workerErrors: 0 };
    for (const result of results) {
      if (result.status === "rejected") totals.workerErrors++;
      else { totals.copied += result.value.copied; totals.blocked += result.value.blocked; totals.failed += "failed" in result.value ? result.value.failed : 0; }
    }
    const paused = results.some(result => result.status === "fulfilled" && "paused" in result.value && result.value.paused);
    return { ...totals, ...(paused ? { paused: true } : {}) };
  } finally {
    await db.from("api_cache").delete().eq("cache_key", LEASE_KEY).eq("result->>owner", owner);
  }
}
