import { NextRequest, NextResponse } from "next/server";
import { isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { canViewShippingQuotes } from "@/lib/shipping-quotes-access";
import { isFreightcomConfigured } from "@/lib/freightcom";
import { getStores } from "@/lib/shopify";
import {
  getShippingQuoteSettings,
  listShippingQuotes,
  originIsComplete,
  requoteOrder,
  syncShippingQuotes,
} from "@/lib/shipping-quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  if (!(await canViewShippingQuotes()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  try {
    const [quotes, settings] = await Promise.all([listShippingQuotes({ days }), getShippingQuoteSettings()]);
    const labels = Object.fromEntries(getStores().map((s) => [s.id, s.label]));
    return NextResponse.json(
      {
        quotes: quotes.map((q) => ({ ...q, store_label: labels[q.store_id] ?? q.store_id })),
        configured: isFreightcomConfigured(),
        origin_set: originIsComplete(settings),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load quotes";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}

// POST { action: "requote", storeId, orderId } — fresh quote for one order.
// POST { action: "sync" } — run the same pass the cron runs (management only).
export async function POST(req: NextRequest) {
  if (!(await canViewShippingQuotes()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "requote") {
      const { storeId, orderId } = body;
      if (typeof storeId !== "string" || typeof orderId !== "string")
        return NextResponse.json({ error: "storeId and orderId are required" }, { status: 400, headers: NO_STORE });
      if (!getStores().some((s) => s.id === storeId))
        return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400, headers: NO_STORE });
      const status = await requoteOrder(storeId, orderId);
      return NextResponse.json({ status }, { headers: NO_STORE });
    }
    if (body?.action === "sync") {
      if (!(await isManagementUser()))
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
      const summary = await syncShippingQuotes({ maxQuotes: 10 });
      return NextResponse.json({ summary }, { headers: NO_STORE });
    }
    // Clears every stored quote and starts requoting from scratch — for when
    // the packing rules or crate size change and old quotes no longer reflect
    // reality. The cron finishes whatever this request doesn't get to.
    if (body?.action === "requote_all") {
      if (!(await isManagementUser()))
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
      const { error, count } = await getSupabase()
        .from("shipping_quotes")
        .delete({ count: "exact" })
        .neq("order_id", "");
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
      const summary = await syncShippingQuotes({ maxQuotes: 8 });
      return NextResponse.json({ cleared: count ?? 0, summary }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
