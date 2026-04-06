import { shopifyGraphQL, getStores, REVENUE_FIELDS } from "@/lib/shopify";
import { getSupabase } from "@/lib/supabase";

// ─── Category Configuration ─────────────────────────────────────────────────

export const DEFAULT_FOLLOWUP_DAYS: Record<string, number | null> = {
  new: 3,
  hot_lead: 1,
  considering: 7,
  price_shopping: 4,
  future_project: null,
  no_answer: 2,
  lost: null,
  duplicate: null,
  won: null,
};

export const FOLLOWUP_CATEGORIES: Record<string, {
  label: string;
  followupDays: number | null;
  color: string;
  terminal: boolean;
  requiresNotes: boolean;
}> = {
  new:            { label: "New Lead",       followupDays: 3,    color: "blue",   terminal: false, requiresNotes: false },
  hot_lead:       { label: "Hot Lead",       followupDays: 1,    color: "red",    terminal: false, requiresNotes: false },
  considering:    { label: "Considering",    followupDays: 7,    color: "amber",  terminal: false, requiresNotes: true  },
  price_shopping: { label: "Price Shopping", followupDays: 4,    color: "orange", terminal: false, requiresNotes: false },
  future_project: { label: "Future Project", followupDays: null, color: "purple", terminal: false, requiresNotes: true  },
  no_answer:      { label: "No Answer",      followupDays: 2,    color: "gray",   terminal: false, requiresNotes: false },
  lost:           { label: "Lost",           followupDays: null, color: "slate",  terminal: true,  requiresNotes: true  },
  duplicate:      { label: "Duplicate",      followupDays: null, color: "slate",  terminal: true,  requiresNotes: false },
  won:            { label: "Won",            followupDays: null, color: "green",  terminal: true,  requiresNotes: false },
};

export type LeadStatus = keyof typeof FOLLOWUP_CATEGORIES;

/** Load per-store follow-up day overrides from DB, merged with defaults. */
export async function getFollowupDaysForStore(storeId: string): Promise<Record<string, number | null>> {
  const merged = { ...DEFAULT_FOLLOWUP_DAYS };
  const { data } = await getSupabase()
    .from("followup_config")
    .select("category, followup_days")
    .eq("store_id", storeId);

  for (const row of data ?? []) {
    if (row.category in merged) {
      merged[row.category] = row.followup_days;
    }
  }
  return merged;
}

export const LOSS_REASONS = [
  "Went with competitor",
  "Too expensive",
  "Project cancelled",
  "Unresponsive",
  "Other",
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

export const MAX_ATTEMPTS = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FollowUpLead {
  id: string;
  store_id: string;
  shopify_draft_id: string;
  draft_name: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  quote_amount: number;
  shopify_created_at: string | null;
  shopify_status: string;
  lead_status: LeadStatus;
  next_followup_at: string | null;
  followup_count: number;
  first_synced_at: string;
  last_synced_at: string;
  closed_at: string | null;
  close_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpLog {
  id: string;
  lead_id: string;
  outcome: string;
  notes: string | null;
  logged_by: string;
  created_at: string;
}

// ─── Shopify GraphQL Query ───────────────────────────────────────────────────

interface ShopifyDraftNode {
  id: string;
  name: string;
  createdAt: string;
  status: string;
  subtotalPriceSet: { shopMoney: { amount: string } };
  tags: string[];
  order: { id: string; createdAt: string } | null;
  customer: {
    displayName: string;
    email: string | null;
    phone: string | null;
  } | null;
}

interface DraftEdge {
  node: ShopifyDraftNode;
  cursor: string;
}

function makeFollowUpDraftQuery(dateFilter: string, statusFilter: string, cursor?: string) {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      draftOrders(first: 250, sortKey: ID, reverse: true, query: "created_at:>='${dateFilter}' AND ${statusFilter}"${after}) {
        edges {
          node {
            id name createdAt status
            subtotalPriceSet { shopMoney { amount } }
            tags
            order { id createdAt }
            customer { displayName email phone }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

const MAX_PAGES = 80;

async function fetchDraftsForSync(
  storeId: string,
  fromDate: string,
  statusFilter: string,
): Promise<ShopifyDraftNode[]> {
  const allDrafts: ShopifyDraftNode[] = [];
  let cursor: string | undefined;
  let hasNext = true;
  let pages = 0;

  while (hasNext && pages < MAX_PAGES) {
    const raw = await shopifyGraphQL<{
      draftOrders: { edges: DraftEdge[]; pageInfo: { hasNextPage: boolean } };
    }>(storeId, makeFollowUpDraftQuery(fromDate, statusFilter, cursor));

    const edges = raw.draftOrders.edges;
    allDrafts.push(...edges.map((e) => e.node));
    hasNext = raw.draftOrders.pageInfo.hasNextPage;
    cursor = edges[edges.length - 1]?.cursor;
    pages++;
  }

  return allDrafts;
}

// ─── Sync Logic ──────────────────────────────────────────────────────────────

export interface SyncResult {
  new_leads: number;
  updated_leads: number;
  auto_won: number;
  stale_detected: number;
}

export async function syncDraftOrdersForStore(storeId: string): Promise<SyncResult> {
  const supabase = getSupabase();
  const result: SyncResult = { new_leads: 0, updated_leads: 0, auto_won: 0, stale_detected: 0 };

  // Load store-specific follow-up day config
  const storeDays = await getFollowupDaysForStore(storeId);
  const newLeadDays = storeDays["new"] ?? DEFAULT_FOLLOWUP_DAYS["new"] ?? 3;

  // All-time sync — Shopify paginates up to 20,000 records which is plenty
  const fromDateStr = "2020-01-01";

  // 1. Fetch OPEN and INVOICE_SENT drafts from Shopify
  const [openDrafts, invoiceDrafts] = await Promise.all([
    fetchDraftsForSync(storeId, fromDateStr, "status:open"),
    fetchDraftsForSync(storeId, fromDateStr, "status:invoice_sent"),
  ]);
  const shopifyDrafts = [...openDrafts, ...invoiceDrafts];
  const shopifyDraftIds = new Set(shopifyDrafts.map((d) => d.id));

  // 2. Get existing leads for this store
  const { data: existingLeads } = await supabase
    .from("followup_leads")
    .select("id, shopify_draft_id, lead_status, shopify_status")
    .eq("store_id", storeId);

  const existingByDraftId = new Map(
    (existingLeads ?? []).map((l: { shopify_draft_id: string; id: string; lead_status: string; shopify_status: string }) => [l.shopify_draft_id, l])
  );

  // 3. Upsert — separate new inserts from updates
  const now = new Date().toISOString();
  const firstFollowup = new Date(Date.now() + newLeadDays * 24 * 60 * 60 * 1000).toISOString();

  for (const draft of shopifyDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;

    if (!existing) {
      // New lead
      const { error } = await supabase.from("followup_leads").insert({
        store_id: storeId,
        shopify_draft_id: draft.id,
        draft_name: draft.name,
        customer_name: draft.customer?.displayName || null,
        customer_email: draft.customer?.email || null,
        customer_phone: draft.customer?.phone || null,
        quote_amount: amount,
        shopify_created_at: draft.createdAt,
        shopify_status: draft.status,
        lead_status: "new",
        next_followup_at: firstFollowup,
        followup_count: 0,
        first_synced_at: now,
        last_synced_at: now,
      });
      if (!error) result.new_leads++;
    } else {
      // Update sync fields only — preserve lead_status, next_followup_at, notes
      await supabase
        .from("followup_leads")
        .update({
          draft_name: draft.name,
          customer_name: draft.customer?.displayName || null,
          customer_email: draft.customer?.email || null,
          customer_phone: draft.customer?.phone || null,
          quote_amount: amount,
          shopify_created_at: draft.createdAt,
          shopify_status: draft.status,
          last_synced_at: now,
          updated_at: now,
        })
        .eq("id", existing.id);
      result.updated_leads++;
    }
  }

  // 4. Detect completions — fetch COMPLETED drafts (same 180-day window)
  const completedDrafts = await fetchDraftsForSync(
    storeId,
    fromDateStr,
    "status:completed",
  );

  for (const draft of completedDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;

    if (existing && existing.lead_status !== "won" && existing.lead_status !== "lost") {
      // Existing lead that converted — mark as won
      await supabase
        .from("followup_leads")
        .update({
          lead_status: "won",
          shopify_status: "COMPLETED",
          closed_at: now,
          next_followup_at: null,
          updated_at: now,
        })
        .eq("id", existing.id);

      await supabase.from("followup_logs").insert({
        lead_id: existing.id,
        outcome: "won",
        notes: "Auto-detected from Shopify COMPLETED status",
        logged_by: "system",
      });

      result.auto_won++;
    } else if (!existing) {
      // Completed draft never tracked — insert as already-won lead
      const { error } = await supabase.from("followup_leads").insert({
        store_id: storeId,
        shopify_draft_id: draft.id,
        draft_name: draft.name,
        customer_name: draft.customer?.displayName || null,
        customer_email: draft.customer?.email || null,
        customer_phone: draft.customer?.phone || null,
        quote_amount: amount,
        shopify_created_at: draft.createdAt,
        shopify_status: "COMPLETED",
        lead_status: "won",
        next_followup_at: null,
        followup_count: 0,
        closed_at: draft.order?.createdAt || now,
        first_synced_at: now,
        last_synced_at: now,
      });
      if (!error) result.auto_won++;
    }
  }

  // 5. Detect stale — leads in DB but missing from Shopify
  for (const [draftId, existing] of existingByDraftId) {
    if (
      !shopifyDraftIds.has(draftId) &&
      (existing.shopify_status === "OPEN" || existing.shopify_status === "INVOICE_SENT") &&
      existing.lead_status !== "won" &&
      existing.lead_status !== "lost" &&
      existing.lead_status !== "duplicate"
    ) {
      await supabase
        .from("followup_leads")
        .update({ shopify_status: "DELETED", updated_at: now })
        .eq("id", existing.id);
      result.stale_detected++;
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeNextFollowup(
  status: LeadStatus,
  storeDays: Record<string, number | null>,
  customDate?: string,
): string | null {
  const cat = FOLLOWUP_CATEGORIES[status];
  if (cat.terminal) return null;
  if (status === "future_project" && customDate) return new Date(customDate).toISOString();
  const days = storeDays[status] ?? cat.followupDays;
  if (days === null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
