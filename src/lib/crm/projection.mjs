import { projectCrmRecord } from "./identity.mjs";

// Shared with the local resumable backfill. No credentials are persisted here.
export async function processCrmProjections(db, { budgetMs = 15000, batchSize = 50 } = {}) {
  const metadata = await db.from("crm_metadata").select("key,value").like("key", "%:pipelines");
  if (metadata.error) throw new Error("CRM stage labels are unavailable");
  const stages = {};
  for (const item of metadata.data ?? []) {
    const prefix = item.key.replace(/:pipelines$/, "");
    for (const pipeline of item.value?.results ?? []) for (const stage of pipeline.stages ?? []) stages[`${prefix}:${stage.id}`] = String(stage.label).slice(0, 120);
  }
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const token = crypto.randomUUID();
    const claim = await retryIndexRequest(() => db.rpc("crm_claim_projections", { p_token: token, p_limit: batchSize }));
    if (claim.error) throw new Error("CRM index is unavailable");
    if (!claim.data?.length) return { processed, complete: true };
    const rows = claim.data.map(row => ({ record_id: row.record_id, revision: row.revision, ...projectCrmRecord(row.record, stages) }));
    const saved = await retryIndexRequest(() => db.rpc("crm_commit_projections", { p_token: token, p_rows: rows }));
    if (saved.error) throw new Error("CRM index could not be saved");
    processed += saved.data ?? 0;
  }
  return { processed, complete: false };
}

async function retryIndexRequest(run) {
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    result = await run();
    if (!result.error) return result;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  return result;
}
