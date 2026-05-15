import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { listOrdersWithRollup } from "@/lib/purchasing/queries";
import { logActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const orders = await listOrdersWithRollup();
    return NextResponse.json({ orders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load orders" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  try {
    const body = await req.json();
    const items = (body.items ?? []) as Array<{
      product_id: string;
      qty_ordered: number;
    }>;
    const notes = (body.notes as string | undefined) ?? null;
    const eta_date = (body.eta_date as string | undefined) ?? null;
    const order_type =
      body.order_type === "montreal" ? "montreal" : "china";

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items[] required" }, { status: 400 });
    }
    for (const it of items) {
      if (!it.product_id || !Number.isFinite(Number(it.qty_ordered))) {
        return NextResponse.json(
          { error: "each item needs product_id and numeric qty_ordered" },
          { status: 400 },
        );
      }
    }

    const supabase = getSupabase();

    const productIds = items.map((i) => i.product_id);
    const { data: prods, error: prodErr } = await supabase
      .from("purchasing_products")
      .select("id, unit_cost_landed")
      .in("id", productIds);
    if (prodErr) throw new Error(prodErr.message);
    const costMap = new Map<string, number>();
    for (const p of (prods ?? []) as Array<{
      id: string;
      unit_cost_landed: number | string;
    }>) {
      costMap.set(p.id, Number(p.unit_cost_landed));
    }

    const { data: order, error: orderErr } = await supabase
      .from("purchasing_orders")
      .insert({
        status: "draft",
        order_type,
        supplier_name: order_type === "montreal" ? "Montreal warehouse" : "Allen",
        eta_date,
        notes,
        created_by_email: user?.email?.toLowerCase() ?? null,
      })
      .select()
      .single();
    if (orderErr) throw new Error(orderErr.message);

    const itemRows = items.map((it) => ({
      order_id: order.id,
      product_id: it.product_id,
      qty_ordered: Number(it.qty_ordered),
      qty_received: 0,
      unit_cost_snapshot: costMap.get(it.product_id) ?? 0,
    }));
    const { error: itemsErr } = await supabase
      .from("purchasing_order_items")
      .insert(itemRows);
    if (itemsErr) throw new Error(itemsErr.message);

    revalidateTag("purchasing", "max");
    await logActivity({
      event_type: "order_create",
      order_id: order.id,
      actor_email: user?.email?.toLowerCase() ?? null,
      details: {
        po_number: order.po_number,
        order_type,
        line_count: itemRows.length,
        total_qty: itemRows.reduce((s, r) => s + r.qty_ordered, 0),
      },
    });
    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create order" },
      { status: 500 },
    );
  }
}
