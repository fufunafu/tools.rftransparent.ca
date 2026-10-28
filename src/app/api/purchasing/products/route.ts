import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getPurchasingPlanning } from "@/lib/purchasing/queries";
import { buildFieldDiffs, logActivity } from "@/lib/purchasing/activity";
import type { Category } from "@/lib/purchasing/types";

export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "name",
  "height",
  "width",
  "weight",
  "storage_capacity",
  "unit_cost_landed",
  "current_inventory",
  "avg_monthly_sales_grs",
  "avg_monthly_sales_rf",
  "active",
  "sort_order",
  "notes",
  "category",
]);

export async function GET(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const category = req.nextUrl.searchParams.get("category") as Category | null;
  try {
    const planning = await getPurchasingPlanning();
    const products = category ? planning.products.filter(p => p.category === category) : planning.products;
    return NextResponse.json({ ...planning, products });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load products" },
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
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(k)) payload[k] = v;
    }
    payload.sku = typeof body.sku === "string" ? body.sku.trim() : "";
    if (!payload.sku || !payload.name || !payload.category) {
      return NextResponse.json(
        { error: "sku, name, and category are required" },
        { status: 400 },
      );
    }
    const { data, error } = await getSupabase()
      .from("purchasing_products")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");
    await logActivity({
      event_type: "product_create",
      product_id: data.id,
      actor_email: user?.email?.toLowerCase() ?? null,
      details: { sku: data.sku, name: data.name, category: data.category },
    });
    return NextResponse.json({ product: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create product" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  try {
    const body = await req.json();
    const { id, ...rest } = body as { id: string } & Record<string, unknown>;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (EDITABLE_FIELDS.has(k)) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "no editable fields" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { data: before } = await supabase
      .from("purchasing_products")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (before?.sales_updated_at && ("avg_monthly_sales_rf" in payload || "avg_monthly_sales_grs" in payload)) {
      return NextResponse.json({ error: "Monthly sales come from order history. Review the product matches in Sales history to correct them." }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("purchasing_products")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");

    if (before) {
      const diffs = buildFieldDiffs(
        before as unknown as Record<string, unknown>,
        payload,
        {
          event_type: "product_update",
          product_id: id,
          actor_email: user?.email?.toLowerCase() ?? null,
        },
      );
      for (const d of diffs) await logActivity(d);
    }

    return NextResponse.json({ product: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}
