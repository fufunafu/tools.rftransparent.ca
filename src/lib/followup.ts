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
  created_by_staff: string | null;
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
  order: {
    id: string;
    createdAt: string;
    staffMember?: { firstName: string | null; lastName: string | null } | null;
  } | null;
  customer: {
    displayName: string;
    email: string | null;
    phone: string | null;
  } | null;
  events: {
    edges: { node: { message: string; createdAt: string } }[];
  };
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
            order { id createdAt staffMember { firstName lastName } }
            customer { displayName email phone }
            events(first: 20, sortKey: CREATED_AT) { edges { node { message createdAt } } }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;
}

/**
 * Resolve the staff member responsible for this draft order, in priority order:
 *   1. The linked Order's staffMember (converted drafts — most authoritative).
 *   2. The first "X sent an invoice to …" event. Apps like Quotation often create
 *      drafts programmatically, but a real staff member sends the invoice — that's
 *      the meaningful attribution for the follow-up queue.
 *   3. The creation event ("X created this draft order.") — falls back to the app
 *      name if no human ever sent an invoice.
 */
function extractCreator(draft: ShopifyDraftNode): string | null {
  const staff = draft.order?.staffMember;
  if (staff?.firstName || staff?.lastName) {
    return [staff.firstName, staff.lastName].filter(Boolean).join(" ").trim() || null;
  }
  const events = draft.events?.edges ?? [];
  for (const { node } of events) {
    const match = node.message.match(/^(.+?) sent an invoice to /);
    if (match) return match[1].trim();
  }
  for (const { node } of events) {
    const match = node.message.match(/^(.+?) created this draft order\.?$/);
    if (match) return match[1].trim();
  }
  return null;
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
    }>(
      storeId,
      makeFollowUpDraftQuery(fromDate, statusFilter, cursor),
      undefined,
      { app: "quotation" }, // Quotation app has read_users, required for events + staffMember
    );

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

  // System/placeholder emails that should never appear as leads
  const SKIP_EMAILS = new Set(["application@gmail.com"]);

  // 1. Fetch only INVOICE_SENT drafts — open drafts are unsent works-in-progress.
  //    Filter out system emails before building the ID set so stale detection
  //    will later mark any existing DB records with those emails as DELETED.
  const shopifyDrafts = (await fetchDraftsForSync(storeId, fromDateStr, "status:invoice_sent"))
    .filter((d) => !SKIP_EMAILS.has((d.customer?.email ?? "").toLowerCase()));
  const shopifyDraftIds = new Set(shopifyDrafts.map((d) => d.id));

  // 2. Get existing leads for this store — paginate in 1000-row pages to
  //    bypass PostgREST's server-side db-max-rows cap (client .limit() can't exceed it)
  const existingLeads: { id: string; shopify_draft_id: string; lead_status: string; shopify_status: string }[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("followup_leads")
        .select("id, shopify_draft_id, lead_status, shopify_status")
        .eq("store_id", storeId)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      existingLeads.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  const existingByDraftId = new Map(
    (existingLeads ?? []).map((l: { shopify_draft_id: string; id: string; lead_status: string; shopify_status: string }) => [l.shopify_draft_id, l])
  );

  // 3. Separate new leads from updates, then batch/parallelize
  const now = new Date().toISOString();
  const firstFollowup = new Date(Date.now() + newLeadDays * 24 * 60 * 60 * 1000).toISOString();

  const newActiveLeads: Record<string, unknown>[] = [];
  const newWonLeads: Record<string, unknown>[] = [];
  const updatePromises: Promise<unknown>[] = [];

  for (const draft of shopifyDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;
    const hasOrder = draft.order !== null;

    const createdBy = extractCreator(draft);

    if (!existing) {
      if (hasOrder) {
        newWonLeads.push({
          store_id: storeId,
          shopify_draft_id: draft.id,
          draft_name: draft.name,
          customer_name: draft.customer?.displayName || null,
          customer_email: draft.customer?.email || null,
          customer_phone: draft.customer?.phone || null,
          quote_amount: amount,
          shopify_created_at: draft.createdAt,
          shopify_status: draft.status,
          lead_status: "won",
          next_followup_at: null,
          followup_count: 0,
          closed_at: draft.order!.createdAt,
          first_synced_at: now,
          last_synced_at: now,
          created_by_staff: createdBy,
        });
      } else {
        newActiveLeads.push({
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
          created_by_staff: createdBy,
        });
      }
    } else if (hasOrder && existing.lead_status !== "won" && existing.lead_status !== "lost") {
      updatePromises.push(
        supabase.from("followup_leads").update({
          lead_status: "won",
          shopify_status: draft.status,
          closed_at: draft.order!.createdAt,
          next_followup_at: null,
          updated_at: now,
          last_synced_at: now,
          created_by_staff: createdBy,
        }).eq("id", existing.id).then(async () => {
          await supabase.from("followup_logs").insert({
            lead_id: existing.id,
            outcome: "won",
            notes: "Auto-detected: draft order has a linked order",
            logged_by: "system",
          });
          result.auto_won++;
        })
      );
    } else if (existing) {
      updatePromises.push(
        supabase.from("followup_leads").update({
          draft_name: draft.name,
          customer_name: draft.customer?.displayName || null,
          customer_email: draft.customer?.email || null,
          customer_phone: draft.customer?.phone || null,
          quote_amount: amount,
          shopify_created_at: draft.createdAt,
          shopify_status: draft.status,
          last_synced_at: now,
          updated_at: now,
          created_by_staff: createdBy,
        }).eq("id", existing.id).then(() => { result.updated_leads++; })
      );
    }
  }

  // Batch-insert new leads (100 at a time)
  const BATCH = 100;
  for (let i = 0; i < newActiveLeads.length; i += BATCH) {
    const { error } = await supabase.from("followup_leads").insert(newActiveLeads.slice(i, i + BATCH));
    if (!error) result.new_leads += newActiveLeads.slice(i, i + BATCH).length;
  }
  for (let i = 0; i < newWonLeads.length; i += BATCH) {
    const { error } = await supabase.from("followup_leads").insert(newWonLeads.slice(i, i + BATCH));
    if (!error) result.auto_won += newWonLeads.slice(i, i + BATCH).length;
  }
  // Run all updates in parallel
  await Promise.all(updatePromises);

  // 4. Detect completions — fetch COMPLETED drafts
  const completedDrafts = await fetchDraftsForSync(storeId, fromDateStr, "status:completed");

  const newCompletedLeads: Record<string, unknown>[] = [];
  const completedUpdatePromises: Promise<unknown>[] = [];

  for (const draft of completedDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;
    const createdBy = extractCreator(draft);

    if (existing && existing.lead_status !== "won" && existing.lead_status !== "lost") {
      completedUpdatePromises.push(
        supabase.from("followup_leads").update({
          lead_status: "won",
          shopify_status: "COMPLETED",
          closed_at: now,
          next_followup_at: null,
          updated_at: now,
          created_by_staff: createdBy,
        }).eq("id", existing.id).then(async () => {
          await supabase.from("followup_logs").insert({
            lead_id: existing.id,
            outcome: "won",
            notes: "Auto-detected from Shopify COMPLETED status",
            logged_by: "system",
          });
          result.auto_won++;
        })
      );
    } else if (!existing) {
      newCompletedLeads.push({
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
        created_by_staff: createdBy,
      });
    } else {
      // Already won/lost — backfill creator + last_synced_at without touching status.
      completedUpdatePromises.push(
        supabase.from("followup_leads").update({
          created_by_staff: createdBy,
          last_synced_at: now,
        }).eq("id", existing.id).then(() => { result.updated_leads++; })
      );
    }
  }

  for (let i = 0; i < newCompletedLeads.length; i += BATCH) {
    const { error } = await supabase.from("followup_leads").insert(newCompletedLeads.slice(i, i + BATCH));
    if (!error) result.auto_won += newCompletedLeads.slice(i, i + BATCH).length;
  }
  await Promise.all(completedUpdatePromises);

  // 5. Detect stale — leads in DB but missing from Shopify
  const stalePromises: Promise<unknown>[] = [];
  for (const [draftId, existing] of existingByDraftId) {
    if (
      !shopifyDraftIds.has(draftId) &&
      (existing.shopify_status === "OPEN" || existing.shopify_status === "INVOICE_SENT") &&
      existing.lead_status !== "won" &&
      existing.lead_status !== "lost" &&
      existing.lead_status !== "duplicate"
    ) {
      stalePromises.push(
        supabase.from("followup_leads")
          .update({ shopify_status: "DELETED", updated_at: now })
          .eq("id", existing.id)
          .then(() => { result.stale_detected++; })
      );
    }
  }
  await Promise.all(stalePromises);

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
