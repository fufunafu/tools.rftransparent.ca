// Bounded, sequential work with a shared cooldown across scheduled and local runs.
// If the database cannot report its state, workers leave their durable queues alone.
export function boundedCrmQuery(query) {
  return typeof query?.abortSignal === "function" ? query.abortSignal(AbortSignal.timeout(10000)) : query;
}
export async function createCrmPacer(db, worker, maxBatch = 30) {
  let batchSize = Math.max(1, Math.min(maxBatch, 20));
  let paused = false, worstLatency = 0, failed = false, delayMs = 75, measured = false;
  const started = Date.now();
  try {
    const result = await boundedCrmQuery(db.from("crm_worker_backoff").select("worker,pause_until,batch_size"));
    if (result.error) paused = true;
    const state = result.data?.find(row => row.worker === worker);
    if (state) batchSize = Math.max(1, Math.min(maxBatch, state.batch_size));
    if (result.data?.some(row => row.pause_until && Date.parse(row.pause_until) > Date.now())) paused = true;
    if (Date.now() - started >= 5000) paused = true;
  } catch { paused = true; }
  return {
    get paused() { return paused; },
    get batchSize() { return batchSize; },
    observe(latencyMs, error = false) {
      measured = true;
      worstLatency = Math.max(worstLatency, Math.max(0, Math.round(latencyMs)));
      failed ||= Boolean(error);
      if (error || latencyMs >= 5000) paused = true;
      if (error || latencyMs > 1500) { batchSize = Math.max(1, Math.floor(batchSize / 2)); delayMs = 1000; }
      else if (latencyMs < 500) { batchSize = Math.min(maxBatch, batchSize + 2); delayMs = 75; }
      else delayMs = 250;
    },
    async wait(deadline) {
      if (!paused && Date.now() + delayMs < deadline) await new Promise(resolve => setTimeout(resolve, delayMs));
    },
    async finish() {
      if (!measured) return;
      // Cooldown persistence is best effort during an outage. This invocation
      // still stops even when the database cannot accept the feedback write.
      try { await boundedCrmQuery(db.rpc("crm_worker_feedback", { p_worker: worker, p_latency: Math.min(worstLatency, 2147483647), p_failed: failed })); } catch { /* Queue and source cursors remain intact. */ }
    },
  };
}
