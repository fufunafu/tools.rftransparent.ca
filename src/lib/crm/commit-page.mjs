// Keep the cursor on the previous page until every record and its links are saved.
// A restart can safely replay partial pages because source IDs are upserted.
export async function commitCrmPage(db, payload, previousProgress) {
  async function commit(records, final, depth = 0) {
    const ids = new Set(records.map(record => record.id));
    const result = await db.rpc("crm_commit_sync_page", {
      ...payload,
      p_records: records,
      p_links: payload.p_links.filter(link => ids.has(link.from_id)),
      p_progress: final ? payload.p_progress : previousProgress,
      p_complete: final && payload.p_complete,
    });
    if (!result.error) return;
    if (result.error.code === "57014" && records.length > 1 && depth < 7) {
      const middle = Math.ceil(records.length / 2);
      await commit(records.slice(0, middle), false, depth + 1);
      await commit(records.slice(middle), final, depth + 1);
      return;
    }
    throw new Error(`CRM page could not be saved (${result.error.code || "connection"}). Saved pages are retained.`);
  }
  await commit(payload.p_records, true);
}
