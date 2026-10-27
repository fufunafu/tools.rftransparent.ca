import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabase } from "@/lib/supabase";
import { HUBSPOT_TYPES, hubspotClient, readHubspotPage, readOwners } from "./hubspot.mjs";
import { packHubspotRecord } from "./storage.mjs";
import { commitCrmPage } from "./commit-page.mjs";

interface Progress {
  typeIndex: number;
  archived: boolean;
  after: string | null;
  startedAt: string;
  counts: Record<string, number>;
  completedAt?: string;
  unavailable?: string[];
}

export async function runCrmSync(restart = false, budgetMs = 80_000) {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!portalId || !token) return { skipped: "HubSpot connection is not configured." };
  const db = getSupabase();
  const lease = randomUUID();
  const claimed = await db.rpc("crm_claim_sync", { p_portal: portalId, p_token: lease, p_restart: restart });
  if (claimed.error) throw new Error("CRM sync state unavailable");
  if (!claimed.data) return { skipped: "Sync is already running or the current import is complete." };
  const progress = claimed.data as Progress;
  const request = hubspotClient(token);
  const deadline = Date.now() + budgetMs;
  try {
    const account = await request("/account-info/v3/details");
    if (String(account.portalId) !== portalId) throw new Error("HubSpot account mismatch");
    const owners = await readOwners(request);
    const ownerSave = await db.from("crm_metadata").upsert({ key: `${portalId}:owners`, value: owners, updated_at: new Date().toISOString() });
    if (ownerSave.error) throw new Error("CRM owner save failed");
    let activeType = "";
    let properties: string[] = [];
    let pages = 0;
    while (progress.typeIndex < HUBSPOT_TYPES.length && Date.now() < deadline) {
      const type = HUBSPOT_TYPES[progress.typeIndex];
      if (type !== activeType) {
        const definitions = await request(`/crm/v3/properties/${type}`);
        properties = definitions.results.map((p: { name: string }) => p.name);
        const saved = await db.from("crm_metadata").upsert({ key: `${portalId}:${type}:properties`, value: definitions, updated_at: new Date().toISOString() });
        if (saved.error) throw new Error("CRM field definitions save failed");
        if (["deals", "tickets"].includes(type)) {
          const pipelines = await request(`/crm/v3/pipelines/${type}`);
          const savedPipelines = await db.from("crm_metadata").upsert({ key: `${portalId}:${type}:pipelines`, value: pipelines, updated_at: new Date().toISOString() });
          if (savedPipelines.error) throw new Error("CRM pipeline save failed");
        }
        activeType = type;
      }
      const previousProgress = structuredClone(progress);
      const page = await readHubspotPage(request, { portalId, type, properties, owners, after: progress.after, archived: progress.archived });
      if (page.unavailable) progress.unavailable = [...new Set([...(progress.unavailable ?? []), page.unavailable])];
      if (page.after !== null && String(page.after) === String(progress.after)) throw new Error("Repeated HubSpot cursor");
      const group = `${type}-${progress.archived ? "archived" : "active"}`;
      progress.counts[group] = (progress.counts[group] ?? 0) + page.records.length;
      if (page.after !== null) progress.after = String(page.after);
      else if (!progress.archived) { progress.archived = true; progress.after = null; }
      else { progress.typeIndex++; progress.archived = false; progress.after = null; }
      const complete = progress.typeIndex === HUBSPOT_TYPES.length;
      if (complete) progress.completedAt = new Date().toISOString();
      await commitCrmPage(db, { p_portal: portalId, p_token: lease, p_records: page.records.map(packHubspotRecord), p_links: page.links, p_progress: progress, p_complete: complete }, previousProgress);
      pages++;
    }
    return { pages, complete: Boolean(progress.completedAt), counts: progress.counts };
  } catch {
    await db.from("crm_sync_state").update({ status: "error", last_error: "Import stopped. Check HubSpot permissions, API availability, and database setup, then resume. Saved pages are retained.", updated_at: new Date().toISOString() }).eq("portal_id", portalId).eq("lease_token", lease);
    throw new Error("HubSpot import stopped. Saved pages are retained; resume to retry.");
  } finally {
    await db.from("crm_sync_state").update({ lease_until: null }).eq("portal_id", portalId).eq("lease_token", lease);
  }
}
