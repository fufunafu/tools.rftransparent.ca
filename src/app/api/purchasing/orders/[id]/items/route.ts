import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const { id: orderId } = await params;
  try {
    const body = await req.json();
    const qty_ordered = Number(body.qty_ordered);
    if (!Number.isFinite(qty_ordered) || qty_ordered <= 0) {
      return NextResponse.json(
        { error: "qty_ordered must be a positive number" },
        { status: 400 },
      );
    }

    const supabase = getSupabase();
    const product_id = (body.product_id as string | undefined) ?? null;
    const custom_description =
      typeof body.custom_description === "string" && body.custom_description.trim()
        ? body.custom_description.trim()
        : null;

    if (!product_id && !custom_description) {
      return NextResponse.json(
        { error: "Either product_id or custom_description is required" },
        { status: 400 },
      );
    }

    let unit_cost_snapshot: number;
    if (product_id) {
      const { data: prod, error: prodErr } = await supabase
        .from("purchasing_products")
        .select("unit_cost_landed")
        .eq("id", product_id)
        .maybeSingle();
      if (prodErr) throw new Error(prodErr.message);
      if (!prod) {
        return NextResponse.json({ error: "Unknown product" }, { status: 400 });
      }
      unit_cost_snapshot = Number(prod.unit_cost_landed);
    } else {
      // Custom item — caller may pass a cost; default to 0.
      unit_cost_snapshot = Number.isFinite(Number(body.unit_cost_snapshot))
        ? Number(body.unit_cost_snapshot)
        : 0;
    }

    const { data, error } = await supabase
      .from("purchasing_order_items")
      .insert({
        order_id: orderId,
        product_id,
        custom_description,
        qty_ordered,
        qty_received: 0,
        unit_cost_snapshot,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");
    await logActivity({
      event_type: "item_add",
      order_id: orderId,
      product_id,
      new_value: custom_description
        ? `custom: ${custom_description} × ${qty_ordered}`
        : String(qty_ordered),
      actor_email: user?.email?.toLowerCase() ?? null,
    });
    return NextResponse.json({ item: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add item" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const { id: orderId } = await params;
  try {
    const body = await req.json();
    const { item_id, ...rest } = body as {
      item_id: string;
    } & Record<string, unknown>;
    if (!item_id) {
      return NextResponse.json({ error: "item_id required" }, { status: 400 });
    }
    const payload: Record<string, unknown> = {};
    if (rest.qty_ordered !== undefined)
      payload.qty_ordered = Number(rest.qty_ordered);
    if (rest.qty_received !== undefined)
      payload.qty_received = Number(rest.qty_received);
    if (rest.unit_cost_snapshot !== undefined)
      payload.unit_cost_snapshot = Number(rest.unit_cost_snapshot);
    if (rest.notes !== undefined) payload.notes = rest.notes;
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data: before } = await supabase
      .from("purchasing_order_items")
      .select("product_id, qty_ordered, qty_received")
      .eq("id", item_id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("purchasing_order_items")
      .update(payload)
      .eq("id", item_id)
      .eq("order_id", orderId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");

    if (before) {
      const actorEmail = user?.email?.toLowerCase() ?? null;
      if (
        payload.qty_ordered !== undefined &&
        Number(payload.qty_ordered) !== Number(before.qty_ordered)
      ) {
        await logActivity({
          event_type: "item_qty_ordered",
          order_id: orderId,
          product_id: before.product_id as string,
          old_value: String(before.qty_ordered),
          new_value: String(payload.qty_ordered),
          actor_email: actorEmail,
        });
      }
      if (
        payload.qty_received !== undefined &&
        Number(payload.qty_received) !== Number(before.qty_received)
      ) {
        await logActivity({
          event_type: "item_qty_received",
          order_id: orderId,
          product_id: before.product_id as string,
          old_value: String(before.qty_received),
          new_value: String(payload.qty_received),
          actor_email: actorEmail,
        });
      }
    }

    return NextResponse.json({ item: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update item" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const { id: orderId } = await params;
  const itemId = req.nextUrl.searchParams.get("item_id");
  if (!itemId) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }
  try {
    const supabase = getSupabase();
    const { data: meta } = await supabase
      .from("purchasing_order_items")
      .select("product_id, qty_ordered")
      .eq("id", itemId)
      .maybeSingle();
    const { error } = await supabase
      .from("purchasing_order_items")
      .delete()
      .eq("id", itemId)
      .eq("order_id", orderId);
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");
    await logActivity({
      event_type: "item_remove",
      order_id: orderId,
      product_id: (meta?.product_id as string) ?? null,
      old_value: meta ? String(meta.qty_ordered) : null,
      actor_email: user?.email?.toLowerCase() ?? null,
    });
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
