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

export async function processOutreachEvents() {
  const db = getSupabase();
  // Five events, at most three email pages each, stays below Instantly's
  // documented email-list limit for a single worker run.
  const { data, error } = await db.rpc("outreach_claim", { p_limit: 5 });
  if (error) throw new Error("outreach_claim_failed");
  const summary = { claimed: 0, processed: 0, held: 0, errors: 0 };
  for (const row of (data ?? []) as ClaimedEvent[]) {
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
