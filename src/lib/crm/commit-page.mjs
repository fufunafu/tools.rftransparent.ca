import { boundedCrmQuery } from "./worker-pacing.mjs";

// Keep the cursor on the previous page until every record and its links are saved.
// A restart can safely replay partial pages because source IDs are upserted.
export async function commitCrmPage(db, payload, previousProgress, pacing) {
  async function commit(records, final, depth = 0) {
    const ids = new Set(records.map(record => record.id));
    const started = Date.now();
    const result = await boundedCrmQuery(db.rpc("crm_commit_sync_page", {
      ...payload,
      p_records: records,
      p_links: payload.p_links.filter(link => ids.has(link.from_id)),
      p_progress: final ? payload.p_progress : previousProgress,
      p_complete: final && payload.p_complete,
    }));
    pacing?.observe(Date.now() - started, result.error);
    if (!result.error) return;
    if (pacing) throw new CrmImportPaused();
    if (result.error.code === "57014" && records.length > 1 && depth < 7) {
      const middle = Math.ceil(records.length / 2);
      await commit(records.slice(0, middle), false, depth + 1);
      await commit(records.slice(middle), final, depth + 1);
      return;
    }
    throw new Error(`CRM page could not be saved (${result.error.code || "connection"}). Saved pages are retained.`);
  }
  if (!pacing || !payload.p_records.length) { await commit(payload.p_records, true); return; }
  let offset = 0;
  while (offset < payload.p_records.length) {
    if (pacing.paused) throw new CrmImportPaused();
    const chunk = payload.p_records.slice(offset, offset + pacing.batchSize);
    offset += chunk.length;
    await commit(chunk, offset === payload.p_records.length);
    if (offset < payload.p_records.length) await pacing.wait(Infinity);
  }
}

export class CrmImportPaused extends Error {
  constructor() { super("Import paused while the database recovers. Saved progress is retained."); }
}
