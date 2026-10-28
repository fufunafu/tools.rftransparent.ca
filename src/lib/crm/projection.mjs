import { projectCrmRecord } from "./identity.mjs";
import { boundedCrmQuery, createCrmPacer } from "./worker-pacing.mjs";

// Shared with the local resumable backfill. No credentials are persisted here.
export async function processCrmProjections(db, { budgetMs = 15000, batchSize = 30 } = {}) {
  const pacer = await createCrmPacer(db, "index", batchSize);
  if (pacer.paused) return { processed: 0, complete: false, paused: true };
  let requestStart = Date.now();
  const metadata = await boundedCrmQuery(db.from("crm_metadata").select("key,value").like("key", "%:pipelines"));
  pacer.observe(Date.now() - requestStart, metadata.error);
  if (pacer.paused) { await pacer.finish(); return { processed: 0, complete: false, paused: true }; }
  const stages = {};
  for (const item of metadata.data ?? []) {
    const prefix = item.key.replace(/:pipelines$/, "");
    for (const pipeline of item.value?.results ?? []) for (const stage of pipeline.stages ?? []) stages[`${prefix}:${stage.id}`] = String(stage.label).slice(0, 120);
  }
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  try { while (Date.now() < deadline && !pacer.paused) {
    const token = crypto.randomUUID();
    requestStart = Date.now();
    const claim = await boundedCrmQuery(db.rpc("crm_claim_projections", { p_token: token, p_limit: pacer.batchSize }));
    pacer.observe(Date.now() - requestStart, claim.error);
    if (claim.error) return { processed, complete: false, paused: true, failed: true };
    if (!claim.data?.length) return { processed, complete: true };
    if (pacer.paused) break;
    const rows = claim.data.map(row => ({ record_id: row.record_id, revision: row.revision, ...projectCrmRecord(row.record, stages) }));
    requestStart = Date.now();
    const saved = await boundedCrmQuery(db.rpc("crm_commit_projections", { p_token: token, p_rows: rows }));
    pacer.observe(Date.now() - requestStart, saved.error);
    if (saved.error) return { processed, complete: false, paused: true, failed: true };
    processed += saved.data ?? 0;
    await pacer.wait(deadline);
  } return { processed, complete: false, ...(pacer.paused ? { paused: true } : {}) };
  } catch { pacer.observe(0, true); return { processed, complete: false, paused: true, failed: true }; }
  finally { await pacer.finish(); }
}
