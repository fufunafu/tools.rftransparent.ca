import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getOrderDetail } from "@/lib/purchasing/queries";
import {
  buildFieldDiffs,
  logActivity,
  type ActivityEventType,
} from "@/lib/purchasing/activity";
import type { OrderStatus } from "@/lib/purchasing/types";

export const dynamic = "force-dynamic";

const VALID_STATUS: OrderStatus[] = [
  "draft",
  "ordered",
  "in_transit",
  "received",
  "cancelled",
];

const PATCH_FIELDS = new Set([
  "po_number",
  "status",
  "supplier_name",
  "order_date",
  "eta_date",
  "received_date",
  "notes",
]);

const FIELD_EVENT_MAP: Record<string, ActivityEventType> = {
  status: "order_status",
  eta_date: "order_eta",
  notes: "order_notes",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const order = await getOrderDetail(id);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load order" },
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
  const { id } = await params;
  try {
    const body = await req.json();
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (PATCH_FIELDS.has(k)) payload[k] = v;
    }
    if (payload.status && !VALID_STATUS.includes(payload.status as OrderStatus)) {
      return NextResponse.json(
        { error: `status must be one of ${VALID_STATUS.join(", ")}` },
        { status: 400 },
      );
    }
    if (payload.po_number !== undefined) {
      const trimmed = typeof payload.po_number === "string" ? payload.po_number.trim() : "";
      if (!trimmed) {
        return NextResponse.json(
          { error: "PO number cannot be empty" },
          { status: 400 },
        );
      }
      payload.po_number = trimmed;
    }
    if (payload.status === "ordered" && payload.order_date === undefined) {
      payload.order_date = new Date().toISOString().slice(0, 10);
    }
    if (payload.status === "received" && payload.received_date === undefined) {
      payload.received_date = new Date().toISOString().slice(0, 10);
    }

    const supabase = getSupabase();
    const { data: before } = await supabase
      .from("purchasing_orders")
      .select("status, eta_date, notes, supplier_name, order_date, received_date")
      .eq("id", id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("purchasing_orders")
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
          event_type: "order_status",
          order_id: id,
          actor_email: user?.email?.toLowerCase() ?? null,
        },
      );
      for (const d of diffs) {
        await logActivity({
          ...d,
          event_type: FIELD_EVENT_MAP[d.field ?? ""] ?? "order_status",
        });
      }
    }

    return NextResponse.json({ order: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const { id } = await params;
  try {
    const supabase = getSupabase();
    const { data: existing, error: readErr } = await supabase
      .from("purchasing_orders")
      .select("status, po_number")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (existing.status !== "draft" && existing.status !== "cancelled") {
      return NextResponse.json(
        {
          error:
            "Only draft or cancelled orders can be deleted. Cancel the order first.",
        },
        { status: 400 },
      );
    }
    const { error } = await supabase
      .from("purchasing_orders")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");
    await logActivity({
      event_type: "order_delete",
      actor_email: user?.email?.toLowerCase() ?? null,
      details: { po_number: existing.po_number ?? null },
    });
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
