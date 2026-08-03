import { shopifyGraphQL } from "@/lib/shopify";
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
  duplicate:      { label: "Duplicate",      followupDays: null, color: "slate",  terminal: true,  requiresNotes: true  },
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
  customer_orders_count: number | null;
  // Everyone who created or invoiced the quote (parsed from the Shopify event
  // timeline). last_invoice_sender drives Quotes-by-Staff attribution.
  last_invoice_sender: string | null;
  contributors: string[] | null;
  // Set by the Re-Quote action when an existing quote is refreshed (new
  // measurements, or a lost lead that came back). Optional — populated once the
  // requoted_at migration is applied.
  requoted_at?: string | null;
  // Set when staff dismiss this lead's email group as "not a duplicate" in the
  // Duplicates tab. Optional — populated once migration 056 is applied.
  dup_dismissed_at?: string | null;
  dup_dismissed_by?: string | null;
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
    numberOfOrders: string | null;
  } | null;
  events: {
    edges: { node: { message: string; createdAt: string } }[];
  };
}

interface DraftEdge {
  node: ShopifyDraftNode;
  cursor: string;
}

function makeFollowUpDraftQuery(dateFilter: string, statusFilter: string, cursor?: string, dateField = "created_at") {
  const after = cursor ? `, after: "${cursor}"` : "";
  return `
    query {
      draftOrders(first: 250, sortKey: ID, reverse: true, query: "${dateField}:>='${dateFilter}' AND ${statusFilter}"${after}) {
        edges {
          node {
            id name createdAt status
            subtotalPriceSet { shopMoney { amount } }
            tags
            order { id createdAt staffMember { firstName lastName } }
            customer { displayName email phone numberOfOrders }
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

/**
 * Parse the draft's event timeline for everyone who worked the quote and who
 * sent the most recent invoice. Names are parsed from event message text
 * (e.g. "Yousif Kola created this draft order.", "Shanaz Rohoman sent an
 * invoice to …") — the same English patterns extractCreator relies on.
 *
 *   - lastInvoiceSender: staff on the most recent "sent an invoice" event.
 *     This drives Quotes-by-Staff attribution (falls back to created_by_staff
 *     when a quote was never invoiced).
 *   - contributors: distinct staff who created or invoiced the draft, in the
 *     order they first appear.
 */
function extractContributors(draft: ShopifyDraftNode): {
  lastInvoiceSender: string | null;
  contributors: string[];
} {
  const events = draft.events?.edges ?? []; // CREATED_AT ascending (oldest first)
  let lastInvoiceSender: string | null = null;
  const contributors: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const name = raw?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      contributors.push(name);
    }
  };

  for (const { node } of events) {
    const created = node.message.match(/^(.+?) created this draft order\.?$/);
    if (created) { add(created[1]); continue; }
    const invoiced = node.message.match(/^(.+?) sent an invoice to /);
    if (invoiced) { lastInvoiceSender = invoiced[1].trim(); add(invoiced[1]); continue; }
  }

  // Converted drafts also expose the closing staff member on the linked order.
  const staff = draft.order?.staffMember;
  if (staff?.firstName || staff?.lastName) {
    add([staff.firstName, staff.lastName].filter(Boolean).join(" "));
  }

  return { lastInvoiceSender, contributors };
}

const MAX_PAGES = 80;

async function fetchDraftsForSync(
  storeId: string,
  fromDate: string,
  statusFilter: string,
  dateField = "created_at",
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
      makeFollowUpDraftQuery(fromDate, statusFilter, cursor, dateField),
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
  errors: number;
  first_error: string | null;
}

function recordError(result: SyncResult, context: string, error: { message?: string } | null) {
  result.errors++;
  const msg = `[followup-sync] ${context}: ${error?.message ?? "unknown error"}`;
  console.error(msg);
  if (!result.first_error) result.first_error = msg;
}

// Cap concurrent Supabase writes. Firing 2000+ updates via Promise.all all at
// once caused Cloudflare 522s from Supabase ("Connection timed out"). A small
// concurrency window keeps the connection pool healthy without blowing past
// the function timeout.
const WRITE_CONCURRENCY = 25;

async function runWithConcurrency(
  fns: Array<() => PromiseLike<unknown>>,
  concurrency: number,
): Promise<void> {
  for (let i = 0; i < fns.length; i += concurrency) {
    await Promise.all(fns.slice(i, i + concurrency).map((fn) => fn()));
  }
}

// How far back an incremental sync looks. A stateless lookback buffer (rather
// than a stored cursor) that tolerates skipped/overlapping timer ticks — every
// write is an idempotent upsert or no-op update, so re-pulling a draft we
// already have is harmless.
const INCREMENTAL_LOOKBACK_MS = 10 * 60 * 1000;

/**
 * Sync draft orders from Shopify into followup_leads.
 *
 * Full mode (default): pulls every INVOICE_SENT + COMPLETED draft all-time and
 * runs stale detection. Heavy (30–60s) — used by the daily cron and the manual
 * "Sync from Shopify" button.
 *
 * Incremental mode ({ incremental: true }): pulls only drafts whose `updated_at`
 * falls in the last few minutes, loads just the matching DB rows, and skips
 * stale detection (which needs the full draft list to know what's missing).
 * Cheap enough to run on a short client-side timer for near-live refresh.
 */
export async function syncDraftOrdersForStore(
  storeId: string,
  opts: { incremental?: boolean } = {},
): Promise<SyncResult> {
  const incremental = opts.incremental ?? false;
  const supabase = getSupabase();
  const result: SyncResult = {
    new_leads: 0,
    updated_leads: 0,
    auto_won: 0,
    stale_detected: 0,
    errors: 0,
    first_error: null,
  };

  // Load store-specific follow-up day config
  const storeDays = await getFollowupDaysForStore(storeId);
  const newLeadDays = storeDays["new"] ?? DEFAULT_FOLLOWUP_DAYS["new"] ?? 3;

  // Full sync scans all-time (Shopify paginates up to 20,000 records, plenty);
  // incremental scans only drafts changed in the recent lookback window.
  const dateField = incremental ? "updated_at" : "created_at";
  const fromDateStr = incremental
    ? new Date(Date.now() - INCREMENTAL_LOOKBACK_MS).toISOString()
    : "2020-01-01";

  // System/placeholder emails that should never appear as leads
  const SKIP_EMAILS = new Set(["application@gmail.com"]);

  // 1. Fetch only INVOICE_SENT drafts — open drafts are unsent works-in-progress.
  //    Filter out system emails before building the ID set so stale detection
  //    will later mark any existing DB records with those emails as DELETED.
  const shopifyDrafts = (await fetchDraftsForSync(storeId, fromDateStr, "status:invoice_sent", dateField))
    .filter((d) => !SKIP_EMAILS.has((d.customer?.email ?? "").toLowerCase()));
  const shopifyDraftIds = new Set(shopifyDrafts.map((d) => d.id));

  // Incremental mode fetches the COMPLETED drafts once here (to scope the
  // existing-rows load) and reuses them in step 4, instead of querying Shopify
  // twice on every timer tick. Full mode fetches them lazily in step 4.
  let completedDraftsPrefetched: ShopifyDraftNode[] | null = null;

  // 2. Get existing leads. Full sync loads every row for the store (needed for
  //    stale detection); incremental loads only the rows matching the drafts we
  //    just fetched, which is far cheaper.
  const existingLeads: { id: string; shopify_draft_id: string; lead_status: string; shopify_status: string }[] = [];
  if (incremental) {
    // The completed-drafts pass (step 4) needs the matching rows too, so load
    // for both the invoice_sent and completed draft IDs.
    completedDraftsPrefetched = await fetchDraftsForSync(storeId, fromDateStr, "status:completed", dateField);
    const wantedIds = Array.from(new Set([...shopifyDraftIds, ...completedDraftsPrefetched.map((d) => d.id)]));
    const PAGE = 200;
    for (let i = 0; i < wantedIds.length; i += PAGE) {
      const { data } = await supabase
        .from("followup_leads")
        .select("id, shopify_draft_id, lead_status, shopify_status")
        .eq("store_id", storeId)
        .in("shopify_draft_id", wantedIds.slice(i, i + PAGE));
      if (data) existingLeads.push(...data);
    }
  } else {
    // Paginate in 1000-row pages to bypass PostgREST's server-side db-max-rows
    // cap (client .limit() can't exceed it).
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
  // Build update FACTORIES, not pending promises. Eager promises would all
  // start immediately when pushed; factories let runWithConcurrency cap how
  // many are in flight at a time.
  const updateFns: Array<() => PromiseLike<unknown>> = [];

  for (const draft of shopifyDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;
    const hasOrder = draft.order !== null;

    const createdBy = extractCreator(draft);
    const contrib = extractContributors(draft);
    const ordersCount = draft.customer?.numberOfOrders != null
      ? parseInt(draft.customer.numberOfOrders, 10)
      : null;

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
          customer_orders_count: ordersCount,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
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
          customer_orders_count: ordersCount,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
        });
      }
    } else if (hasOrder && existing.lead_status !== "won" && existing.lead_status !== "lost") {
      updateFns.push(() =>
        supabase.from("followup_leads").update({
          lead_status: "won",
          shopify_status: draft.status,
          closed_at: draft.order!.createdAt,
          next_followup_at: null,
          updated_at: now,
          last_synced_at: now,
          created_by_staff: createdBy,
          customer_orders_count: ordersCount,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
        }).eq("id", existing.id).then(async ({ error }) => {
          if (error) {
            recordError(result, `auto-win update lead ${existing.id}`, error);
            return;
          }
          const { error: logError } = await supabase.from("followup_logs").insert({
            lead_id: existing.id,
            outcome: "won",
            notes: "Auto-detected: draft order has a linked order",
            logged_by: "system",
          });
          if (logError) recordError(result, `auto-win log for ${existing.id}`, logError);
          result.auto_won++;
        })
      );
    } else if (existing) {
      updateFns.push(() =>
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
          customer_orders_count: ordersCount,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
        }).eq("id", existing.id).then(({ error }) => {
          if (error) recordError(result, `update lead ${existing.id}`, error);
          else result.updated_leads++;
        })
      );
    }
  }

  // Batch-insert new leads (100 at a time). Use upsert + ignoreDuplicates
  // because a concurrent sync (cron + manual click, or two manual clicks)
  // can insert the same draft between our load of existingLeads and the
  // insert. The unique key (store_id, shopify_draft_id) would otherwise
  // throw, even though "do nothing" is the right answer.
  const BATCH = 100;
  const UPSERT_OPTS = { onConflict: "store_id,shopify_draft_id", ignoreDuplicates: true } as const;
  for (let i = 0; i < newActiveLeads.length; i += BATCH) {
    const slice = newActiveLeads.slice(i, i + BATCH);
    const { error } = await supabase.from("followup_leads").upsert(slice, UPSERT_OPTS);
    if (error) recordError(result, `insert ${slice.length} new active leads`, error);
    else result.new_leads += slice.length;
  }
  for (let i = 0; i < newWonLeads.length; i += BATCH) {
    const slice = newWonLeads.slice(i, i + BATCH);
    const { error } = await supabase.from("followup_leads").upsert(slice, UPSERT_OPTS);
    if (error) recordError(result, `insert ${slice.length} new won leads`, error);
    else result.auto_won += slice.length;
  }
  // Run updates with a small concurrency window (see WRITE_CONCURRENCY).
  await runWithConcurrency(updateFns, WRITE_CONCURRENCY);

  // 4. Detect completions — fetch COMPLETED drafts (reuse the incremental
  //    prefetch from step 2 when present).
  const completedDrafts = completedDraftsPrefetched
    ?? await fetchDraftsForSync(storeId, fromDateStr, "status:completed", dateField);
  // Drafts completed this run must NOT be treated as "missing/stale" in step 5.
  // A draft that completes between syncs drops out of the OPEN-drafts list, so
  // without this guard step 5 would overwrite its fresh COMPLETED status with
  // DELETED (it decides off the pre-sync snapshot, which still says INVOICE_SENT).
  const completedDraftIds = new Set(completedDrafts.map((d) => d.id));

  const newCompletedLeads: Record<string, unknown>[] = [];
  const completedUpdateFns: Array<() => PromiseLike<unknown>> = [];

  for (const draft of completedDrafts) {
    const existing = existingByDraftId.get(draft.id);
    const amount = parseFloat(draft.subtotalPriceSet.shopMoney.amount) || 0;
    const createdBy = extractCreator(draft);
    const contrib = extractContributors(draft);
    const ordersCount = draft.customer?.numberOfOrders != null
      ? parseInt(draft.customer.numberOfOrders, 10)
      : null;

    if (existing && existing.lead_status !== "won" && existing.lead_status !== "lost") {
      completedUpdateFns.push(() =>
        supabase.from("followup_leads").update({
          lead_status: "won",
          shopify_status: "COMPLETED",
          closed_at: now,
          next_followup_at: null,
          updated_at: now,
          created_by_staff: createdBy,
          customer_orders_count: ordersCount,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
        }).eq("id", existing.id).then(async ({ error }) => {
          if (error) {
            recordError(result, `completed-win update lead ${existing.id}`, error);
            return;
          }
          const { error: logError } = await supabase.from("followup_logs").insert({
            lead_id: existing.id,
            outcome: "won",
            notes: "Auto-detected from Shopify COMPLETED status",
            logged_by: "system",
          });
          if (logError) recordError(result, `completed-win log for ${existing.id}`, logError);
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
        customer_orders_count: ordersCount,
        last_invoice_sender: contrib.lastInvoiceSender,
        contributors: contrib.contributors,
      });
    } else {
      // Already won/lost — backfill creator/contributors + last_synced_at without touching status.
      completedUpdateFns.push(() =>
        supabase.from("followup_leads").update({
          created_by_staff: createdBy,
          customer_orders_count: ordersCount,
          last_synced_at: now,
          last_invoice_sender: contrib.lastInvoiceSender,
          contributors: contrib.contributors,
        }).eq("id", existing.id).then(({ error }) => {
          if (error) recordError(result, `backfill lead ${existing.id}`, error);
          else result.updated_leads++;
        })
      );
    }
  }

  for (let i = 0; i < newCompletedLeads.length; i += BATCH) {
    const slice = newCompletedLeads.slice(i, i + BATCH);
    const { error } = await supabase.from("followup_leads").upsert(slice, UPSERT_OPTS);
    if (error) recordError(result, `insert ${slice.length} completed leads`, error);
    else result.auto_won += slice.length;
  }
  await runWithConcurrency(completedUpdateFns, WRITE_CONCURRENCY);

  // 5. Detect stale — leads in DB but missing from Shopify. Requires the full
  //    draft list to know what's missing, so incremental mode skips it and
  //    leaves stale detection to the full sync (cron + manual button).
  const staleFns: Array<() => PromiseLike<unknown>> = [];
  if (!incremental) for (const [draftId, existing] of existingByDraftId) {
    if (
      !shopifyDraftIds.has(draftId) &&
      !completedDraftIds.has(draftId) && // completed this run — not stale (step 4 just won it)
      (existing.shopify_status === "OPEN" || existing.shopify_status === "INVOICE_SENT") &&
      existing.lead_status !== "won" &&
      existing.lead_status !== "lost" &&
      existing.lead_status !== "duplicate"
    ) {
      staleFns.push(() =>
        supabase.from("followup_leads")
          .update({ shopify_status: "DELETED", updated_at: now })
          .eq("id", existing.id)
          .then(({ error }) => {
            if (error) recordError(result, `mark stale lead ${existing.id}`, error);
            else result.stale_detected++;
          })
      );
    }
  }
  await runWithConcurrency(staleFns, WRITE_CONCURRENCY);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Add N business days to `start`, skipping Saturdays and Sundays. */
function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

export function computeNextFollowup(
  status: LeadStatus,
  storeDays: Record<string, number | null>,
  customDate?: string,
): string | null {
  const cat = FOLLOWUP_CATEGORIES[status];
  if (cat.terminal) return null;
  // future_project: the user explicitly picked a date — respect it as-is.
  if (status === "future_project" && customDate) return new Date(customDate).toISOString();
  const days = storeDays[status] ?? cat.followupDays;
  if (days === null) return null;
  // No one works weekends — "2 days from Friday" means Tuesday, not Sunday.
  return addBusinessDays(new Date(), days).toISOString();
}
