"use client";

import Link from "next/link";
import useSWR from "swr";
import type { ActivityEvent } from "@/lib/purchasing/activity";

interface Props {
  productId?: string;
  orderId?: string;
  title?: string;
  limit?: number;
}

const EVENT_VERB: Record<string, string> = {
  product_create: "added product",
  product_update: "updated",
  order_create: "created PO",
  order_status: "changed status",
  order_eta: "updated ETA",
  order_notes: "updated notes",
  order_delete: "deleted PO",
  item_add: "added line item",
  item_qty_ordered: "changed qty ordered",
  item_qty_received: "marked received",
  item_remove: "removed line item",
  bulk_inventory: "bulk inventory upload",
  settings_update: "updated settings",
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function actor(email: string | null): string {
  if (!email) return "Someone";
  return email.split("@")[0];
}

function describe(e: ActivityEvent): React.ReactNode {
  const verb = EVENT_VERB[e.event_type] ?? e.event_type;
  const fragments: React.ReactNode[] = [];
  if (e.po_number && e.order_id) {
    fragments.push(
      <Link key="po" href={`/warehouse/purchasing/orders/${e.order_id}`}
        className="font-mono text-accent hover:underline">{e.po_number}</Link>,
    );
  } else if (e.sku) {
    fragments.push(<span key="sku" className="font-mono">{e.sku}</span>);
  }
  if (e.field) {
    fragments.push(
      <span key="field" className="text-sand-500"> ({e.field}
        {e.old_value !== null && e.new_value !== null
          ? `: ${e.old_value} → ${e.new_value}` : ""})
      </span>,
    );
  }
  if (e.event_type === "bulk_inventory" && e.details) {
    const d = e.details as { applied?: number; skipped_count?: number };
    fragments.push(
      <span key="bulk" className="text-sand-500"> ({d.applied ?? 0} updated, {d.skipped_count ?? 0} skipped)</span>,
    );
  }
  return (
    <span>
      <span className="font-medium text-sand-900">{actor(e.actor_email)}</span>{" "}
      <span className="text-sand-600">{verb}</span> {fragments}
    </span>
  );
}

export default function RecentActivityPanel({
  productId, orderId, title = "Recent activity", limit = 20,
}: Props) {
  const qs = new URLSearchParams();
  if (productId) qs.set("product_id", productId);
  if (orderId) qs.set("order_id", orderId);
  qs.set("limit", String(limit));
  const { data, isLoading } = useSWR<{ events: ActivityEvent[] }>(
    `/api/purchasing/activity?${qs.toString()}`,
  );
  const events = data?.events ?? [];

  return (
    <div className="bg-white rounded-xl border border-sand-200/60 p-5">
      <div className="text-[11px] text-sand-400 uppercase tracking-wider font-medium mb-3">
        {title}
      </div>
      {isLoading ? (
        <div className="text-sm text-sand-500">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-sm text-sand-500">No activity recorded yet.</div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="text-sm flex gap-3">
              <span className="text-xs text-sand-400 tabular-nums shrink-0 w-20">
                {timeAgo(e.created_at)}
              </span>
              <div className="flex-1">{describe(e)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
