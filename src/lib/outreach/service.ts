import "server-only";
import { getSupabase } from "@/lib/supabase";
import { getOutreachConfig, planOutreachEvent, type OutreachEvent } from "./domain";
import { hydrateReply, InstantlyError } from "./instantly";

export async function ingestOutreachEvent(event: OutreachEvent) {
  const { data, error } = await getSupabase().rpc("outreach_ingest", { p_event: event });
  if (error) throw new Error("outreach_storage_unavailable");
  return data as { duplicate: boolean; id?: string };
}

interface ClaimedEvent { id: string; lease_token: string; event: OutreachEvent }

type ProcessingSummary = { claimed: number; processed: number; held: number; errors: number };
async function processClaimed(rows: ClaimedEvent[], summary: ProcessingSummary) {
  const db = getSupabase();
  for (const row of rows) {
    summary.claimed++;
    try {
      const event = await hydrateReply(row.event, process.env.INSTANTLY_API_KEY);
      const plan = planOutreachEvent(event);
      const { data: result, error: applyError } = await db.rpc("outreach_apply", {
        p_id: row.id, p_lease: row.lease_token, p_plan: plan, p_event: event,
      });
      if (applyError) throw new Error("outreach_apply_failed");
      if (result === "held") summary.held++;
      else if (result === "lease_lost") summary.errors++;
      else summary.processed++;
    } catch (error) {
      summary.errors++;
      const code = error instanceof InstantlyError ? error.code : "outreach_processing_failed";
      const { error: failError } = await db.rpc("outreach_fail", { p_id: row.id, p_lease: row.lease_token, p_code: code });
      if (failError) throw new Error("outreach_retry_record_failed");
    }
  }
}
async function claimLane(lane: 'fast' | 'reply', limit: number, id: string | null = null) {
  const {data,error}=await getSupabase().rpc('outreach_claim_lane',{p_limit:limit,p_lane:lane,p_event_id:id});
  if(error)throw new Error('outreach_claim_failed');
  return (data??[]) as ClaimedEvent[];
}
// Called after a committed classification webhook. Uses the same leases and
// idempotent apply path as cron; concurrent deliveries cannot create duplicates.
export async function processImmediateOutreachEvent(id: string) {
  const summary:ProcessingSummary={claimed:0,processed:0,held:0,errors:0};
  await processClaimed(await claimLane('fast',1,id),summary);
  return summary;
}
export async function processOutreachEvents() {
  const summary:ProcessingSummary={claimed:0,processed:0,held:0,errors:0};
  const started=Date.now();
  // Drain inexpensive events in bounded batches, with classifications ahead of
  // sent-email telemetry. Leave time for reply hydration and mailbox syncing.
  for(let batch=0;batch<4 && Date.now()-started<20000;batch++) {
    const rows=await claimLane('fast',25);
    await processClaimed(rows,summary);
    if(rows.length<25)break;
  }
  // Keep the existing provider request budget: at most five replies, each with
  // at most three email-list pages. Fast events never call that external API.
  await processClaimed(await claimLane('reply',5),summary);
  return summary;
}

export function outreachReadiness() {
  return {
    configured: Boolean(getOutreachConfig()),
    apiKeyPresent: Boolean(process.env.INSTANTLY_API_KEY),
    workerEnabled: process.env.OUTREACH_WORKER_ENABLED === "true",
    connectionVerified: false,
    customerSendingEnabled: false,
    missing: [
      !process.env.OUTREACH_INSTANTLY_WORKSPACE_ID && "Instantly workspace ID",
      !process.env.OUTREACH_INSTALLER_CAMPAIGN_ID && "Installer campaign ID",
      !process.env.OUTREACH_MATERIALS_CAMPAIGN_ID && "Materials campaign ID",
      (process.env.OUTREACH_WEBHOOK_SECRET?.length ?? 0) < 32 && "Webhook secret (at least 32 characters)",
      !process.env.INSTANTLY_API_KEY && "Instantly API key for missing reply details",
    ].filter(Boolean) as string[],
  };
}

export async function loadOutreachOverview() {
  const db = getSupabase();
  const results = await Promise.all([
    db.from("outreach_contacts").select("id,email,company_name,paused,owner_email,suppressed_at,suppression_reason,suppression_synced_at,updated_at", { count: "exact" }).order("updated_at", { ascending: false }).limit(100),
    db.from("outreach_events").select("id,status,error_code,event_type,created_at,contact_id").in("status", ["failed","held"]).order("created_at", { ascending: false }).limit(50),
    db.from("outreach_events").select("id", { count: "exact", head: true }).in("status", ["pending","processing"]),
  ]);
  if (results.some((result) => result.error)) throw new Error("outreach_storage_unavailable");
  const contacts = results[0].data ?? [];
  const ids = contacts.map((contact) => contact.id);
  const { data: cases, error: casesError } = ids.length
    ? await db.from("outreach_cases").select("*").in("contact_id", ids)
    : { data: [], error: null };
  if (casesError) throw new Error("outreach_storage_unavailable");
  const caseIds = (cases ?? []).map((row) => row.id);
  const { data: tasks, error: tasksError } = caseIds.length
    ? await db.from("outreach_tasks").select("*").in("case_id", caseIds).eq("status", "open")
    : { data: [], error: null };
  if (tasksError) throw new Error("outreach_storage_unavailable");
  return { contacts, cases: cases ?? [], tasks: tasks ?? [], attention: results[1].data ?? [],
    total: results[0].count ?? 0, pending: results[2].count ?? 0, readiness: outreachReadiness() };
}

export async function loadOutreachContactHistory(contactId: string) {
  const results = await Promise.all([
    getSupabase().from("outreach_events").select("id,event_type,occurred_at,event,plan,status,error_code").eq("contact_id", contactId).order("occurred_at", { ascending: false }).limit(50),
    getSupabase().from("outreach_audit").select("actor_email,action,detail,created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(50),
    getSupabase().from("outreach_contacts").select("*").eq("id", contactId).maybeSingle(),
    getSupabase().from("outreach_cases").select("*").eq("contact_id", contactId),
  ]);
  if (results.some((result) => result.error)) throw new Error("outreach_history_unavailable");
  const cases = results[3].data ?? [];
  const { data: tasks, error } = cases.length ? await getSupabase().from("outreach_tasks").select("*").in("case_id", cases.map((entry) => entry.id)).eq("status", "open") : { data: [], error: null };
  if (error) throw new Error("outreach_history_unavailable");
  return { events: results[0].data ?? [], audit: results[1].data ?? [], contact: results[2].data, cases, tasks: tasks ?? [] };
}
