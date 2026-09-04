// TEMPORARY: data for the combined Leads + Follow-up page at
// /customer-service/tmp. Read-only — writes go through the existing
// /api/customer-service/leads (PATCH) and /api/customer-service/follow-up
// (POST) endpoints. Remove together with that page.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import { STORE_SCOPES } from "@/lib/store-scopes";
import { startOfDayInTimeZone } from "@/lib/dates";
import { getCachedLeads } from "@/lib/customer-service/lead-queries";
import { DEFAULT_LEAD_STORE, leadStoreFromSlug, type LeadStoreId } from "@/lib/customer-service/lead-store";
import type { FollowUpLead } from "@/lib/followup";
import {
  buildCombinedRows,
  countTabs,
  sortByUrgency,
  summarize,
  type CombinedPayload,
} from "@/lib/customer-service/leads-combined";

export const maxDuration = 120;

const PAGE_SIZE = 1000;
const LOOKBACK_DAYS = 365;

function shopifyStoreIdsFor(store: LeadStoreId): string[] {
  const scope = Object.values(STORE_SCOPES).find((candidate) => candidate.phoneStoreIds.includes(store));
  return scope?.shopifyStoreIds ?? [];
}

// Same population as the Follow-up page: sent or completed drafts from the
// last year, minus the internal application@ address.
async function loadQuotes(storeIds: string[], cutoffIso: string): Promise<FollowUpLead[]> {
  if (storeIds.length === 0) return [];
  const supabase = getSupabase();
  const rows: FollowUpLead[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("followup_leads")
      .select("*")
      .in("store_id", storeIds)
      .not("shopify_status", "in", "(OPEN,DELETED)")
      .or("customer_email.is.null,customer_email.neq.application@gmail.com")
      .gte("shopify_created_at", cutoffIso)
      .order("shopify_created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as FollowUpLead[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Quotes a person logged a follow-up on today (business day).
async function loadAddressedQuoteIds(storeIds: string[], todayStartIso: string): Promise<Set<string>> {
  if (storeIds.length === 0) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("followup_logs")
    .select("lead_id, followup_leads!inner(store_id)")
    .in("followup_leads.store_id", storeIds)
    .neq("logged_by", "system")
    .gte("created_at", todayStartIso);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { lead_id: string }[]).map((row) => row.lead_id));
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = leadStoreFromSlug(req.nextUrl.searchParams.get("store")) ?? DEFAULT_LEAD_STORE;
  const shopifyStoreIds = shopifyStoreIdsFor(store);
  const now = new Date();
  const todayStart = startOfDayInTimeZone(now).toISOString();
  const tomorrowStart = startOfDayInTimeZone(now, undefined, 1).toISOString();
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  try {
    const [leads, quotes, addressedQuoteIds] = await Promise.all([
      getCachedLeads(cutoff.toISOString().slice(0, 10), null, store),
      loadQuotes(shopifyStoreIds, cutoff.toISOString()),
      loadAddressedQuoteIds(shopifyStoreIds, todayStart),
    ]);

    const opts = { now, todayStart, tomorrowStart, addressedQuoteIds, storeId: store };
    const rows = sortByUrgency(buildCombinedRows(leads, quotes, opts));
    const payload: CombinedPayload = {
      store,
      generatedAt: now.toISOString(),
      rows,
      summary: summarize(rows, opts),
      counts: countTabs(rows),
      shops: getStores()
        .filter((shop) => shopifyStoreIds.includes(shop.id))
        .map((shop) => ({ id: shop.id, label: shop.label, domain: shop.store })),
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[leads-combined] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
