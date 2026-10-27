import { getSupabase } from "@/lib/supabase";
import { shopifyGraphQL } from "@/lib/shopify";

export interface CompletedQuote {
  id: string;
  status: string;
  order: { id: string; createdAt: string; cancelledAt: string | null; test: boolean; displayFinancialStatus: string } | null;
}

// An email or product overlap alone cannot prove that a quote became an order.
export function confirmedQuoteOrder(draft: CompletedQuote | null) {
  const order = draft?.order;
  return draft?.status === "COMPLETED" && order && !order.cancelledAt && !order.test
    && ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"].includes(order.displayFinancialStatus)
    && Number.isFinite(Date.parse(order.createdAt)) ? order : null;
}

const QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on DraftOrder {
    id status order { id createdAt cancelledAt test displayFinancialStatus }
  } }
}`;

/** Refresh open quotes directly before lead matching, without the full draft import. */
export async function reconcileQuoteOrders(storeId: string) {
  const db = getSupabase();
  const summary = { scanned: 0, won: 0, missing: 0, errors: 0 };
  const rows: Array<{ id: string; shopify_draft_id: string; lead_status: string; updated_at: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("followup_leads")
      .select("id,shopify_draft_id,lead_status,updated_at").eq("store_id", storeId)
      .is("closed_at", null).not("lead_status", "in", "(won,lost,not_applicable,duplicate,deleted)")
      .order("id").range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = rows.slice(offset, offset + 50);
    const response = await shopifyGraphQL<{ nodes: (CompletedQuote | null)[] }>(storeId, QUERY,
      { ids: batch.map(row => row.shopify_draft_id) }, { rejectPartial: true });
    const byId = new Map(response.nodes.filter((row): row is CompletedQuote => row != null).map(row => [row.id, row]));
    for (const row of batch) {
      summary.scanned++;
      const draft = byId.get(row.shopify_draft_id) ?? null;
      if (!draft) summary.missing++;
      const order = confirmedQuoteOrder(draft);
      if (!order) continue;
      const { data, error } = await db.from("followup_leads").update({
        lead_status: "won", shopify_status: "COMPLETED", closed_at: order.createdAt,
        next_followup_at: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", row.id).eq("store_id", storeId).eq("lead_status", row.lead_status)
        .eq("updated_at", row.updated_at).is("closed_at", null).select("id");
      if (error) { summary.errors++; continue; }
      if (!data?.length) continue;
      summary.won++;
      const { error: logError } = await db.from("followup_logs").insert({
        lead_id: row.id, outcome: "won", logged_by: "system",
        notes: `Confirmed Shopify quote ${row.shopify_draft_id} converted to paid order ${order.id}`,
      });
      if (logError) summary.errors++;
    }
  }
  return summary;
}
