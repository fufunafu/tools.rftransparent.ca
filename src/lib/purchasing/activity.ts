import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";

export type ActivityEventType =
  | "product_create"
  | "product_update"
  | "order_create"
  | "order_status"
  | "order_eta"
  | "order_notes"
  | "order_delete"
  | "item_add"
  | "item_qty_ordered"
  | "item_qty_received"
  | "item_remove"
  | "bulk_inventory"
  | "settings_update";

export interface ActivityLogInput {
  event_type: ActivityEventType;
  product_id?: string | null;
  order_id?: string | null;
  field?: string | null;
  old_value?: string | number | boolean | null;
  new_value?: string | number | boolean | null;
  actor_email?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ActivityEvent {
  id: string;
  event_type: ActivityEventType;
  product_id: string | null;
  order_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  sku: string | null;
  product_name: string | null;
  po_number: string | null;
}

export async function logActivity(input: ActivityLogInput): Promise<void> {
  try {
    await getSupabase()
      .from("purchasing_activity_log")
      .insert({
        event_type: input.event_type,
        product_id: input.product_id ?? null,
        order_id: input.order_id ?? null,
        field: input.field ?? null,
        old_value:
          input.old_value === undefined || input.old_value === null
            ? null
            : String(input.old_value),
        new_value:
          input.new_value === undefined || input.new_value === null
            ? null
            : String(input.new_value),
        actor_email: input.actor_email ?? null,
        details: input.details ?? null,
      });
  } catch (err) {
    console.error("[purchasing/activity] log failed", err);
  }
}

export function buildFieldDiffs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  base: Omit<ActivityLogInput, "field" | "old_value" | "new_value">,
): ActivityLogInput[] {
  const out: ActivityLogInput[] = [];
  for (const key of Object.keys(after)) {
    const oldV = before[key];
    const newV = after[key];
    if (String(oldV ?? "") === String(newV ?? "")) continue;
    out.push({
      ...base,
      field: key,
      old_value: (oldV as string | number | null) ?? null,
      new_value: (newV as string | number | null) ?? null,
    });
  }
  return out;
}

interface ListOptions {
  productId?: string;
  orderId?: string;
  limit?: number;
}

export function listActivity({
  productId,
  orderId,
  limit = 50,
}: ListOptions = {}): Promise<ActivityEvent[]> {
  return unstable_cache(
    async () => {
      const supabase = getSupabase();
      let q = supabase
        .from("purchasing_activity_log")
        .select(
          "id, event_type, product_id, order_id, field, old_value, new_value, actor_email, details, created_at, purchasing_products(sku, name), purchasing_orders(po_number)",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (productId) q = q.eq("product_id", productId);
      if (orderId) q = q.eq("order_id", orderId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const prod = r.purchasing_products as
          | { sku: string; name: string }
          | { sku: string; name: string }[]
          | null;
        const p = Array.isArray(prod) ? prod[0] : prod;
        const order = r.purchasing_orders as
          | { po_number: string }
          | { po_number: string }[]
          | null;
        const o = Array.isArray(order) ? order[0] : order;
        return {
          id: String(r.id),
          event_type: r.event_type as ActivityEventType,
          product_id: (r.product_id as string | null) ?? null,
          order_id: (r.order_id as string | null) ?? null,
          field: (r.field as string | null) ?? null,
          old_value: (r.old_value as string | null) ?? null,
          new_value: (r.new_value as string | null) ?? null,
          actor_email: (r.actor_email as string | null) ?? null,
          details: (r.details as Record<string, unknown> | null) ?? null,
          created_at: String(r.created_at),
          sku: p?.sku ?? null,
          product_name: p?.name ?? null,
          po_number: o?.po_number ?? null,
        };
      });
    },
    ["purchasing:activity", productId ?? "_", orderId ?? "_", String(limit)],
    { tags: ["purchasing"], revalidate: 30 },
  )();
}
