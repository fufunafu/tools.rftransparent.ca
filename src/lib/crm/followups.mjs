import { boundedCrmQuery, createCrmPacer } from "./worker-pacing.mjs";

export async function processCrmFollowups(db, { budgetMs = 15000 } = {}) {
  const pacer = await createCrmPacer(db, "followups", 30);
  let processed = 0;
  const deadline = Date.now() + budgetMs;
  try {
    while (!pacer.paused && Date.now() < deadline) {
      const started = Date.now();
      const result = await boundedCrmQuery(db.rpc("crm_refresh_followups", { p_limit: pacer.batchSize }));
      pacer.observe(Date.now() - started, result.error);
      if (result.error) return { processed, complete: false, paused: true, failed: true };
      processed += result.data ?? 0;
      if (!result.data) return { processed, complete: true };
      await pacer.wait(deadline);
    }
    return { processed, complete: false, paused: pacer.paused };
  } catch { pacer.observe(0, true); return { processed, complete: false, paused: true, failed: true }; }
  finally { await pacer.finish(); }
}
