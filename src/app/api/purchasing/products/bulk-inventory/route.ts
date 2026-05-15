import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";

// Body: { rows: [{ sku, on_hand }] }; ?dry_run=true previews without writing.
export async function POST(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "true";
  try {
    const body = await req.json();
    const rows = (body.rows ?? []) as Array<{ sku: string; on_hand: number }>;
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: "rows[] required" }, { status: 400 });
    }

    const supabase = getSupabase();

    const skus = Array.from(
      new Set(rows.map((r) => r.sku?.trim()).filter(Boolean)),
    );
    const { data: existing, error: readErr } = await supabase
      .from("purchasing_products")
      .select("id, sku, name, current_inventory")
      .in("sku", skus);
    if (readErr) throw new Error(readErr.message);

    const bySku = new Map<
      string,
      { id: string; name: string; current_inventory: number }
    >();
    for (const p of (existing ?? []) as Array<{
      id: string;
      sku: string;
      name: string;
      current_inventory: number | string;
    }>) {
      bySku.set(p.sku, {
        id: p.id,
        name: p.name,
        current_inventory: Number(p.current_inventory),
      });
    }

    const skipped: Array<{ sku: string; reason: string }> = [];
    const changes: Array<{
      sku: string;
      name: string;
      current: number;
      proposed: number;
    }> = [];
    let applied = 0;
    let unchanged = 0;

    for (const r of rows) {
      const sku = (r.sku ?? "").trim();
      if (!sku) {
        skipped.push({ sku: "(blank)", reason: "missing SKU" });
        continue;
      }
      const onHand = Number(r.on_hand);
      if (!Number.isFinite(onHand) || onHand < 0) {
        skipped.push({ sku, reason: "invalid quantity" });
        continue;
      }
      const cur = bySku.get(sku);
      if (!cur) {
        skipped.push({ sku, reason: "unknown SKU" });
        continue;
      }
      if (onHand === cur.current_inventory) {
        unchanged++;
        continue;
      }
      changes.push({
        sku,
        name: cur.name,
        current: cur.current_inventory,
        proposed: onHand,
      });
      if (dryRun) {
        applied++;
        continue;
      }
      const { error } = await supabase
        .from("purchasing_products")
        .update({ current_inventory: onHand })
        .eq("id", cur.id);
      if (error) {
        skipped.push({ sku, reason: error.message });
        continue;
      }
      applied++;
    }

    if (!dryRun) {
      revalidateTag("purchasing", "max");
      if (applied > 0 || skipped.length > 0) {
        await logActivity({
          event_type: "bulk_inventory",
          actor_email: user?.email?.toLowerCase() ?? null,
          details: {
            applied,
            unchanged,
            skipped_count: skipped.length,
            total: rows.length,
          },
        });
      }
    }

    return NextResponse.json({
      applied,
      unchanged,
      skipped,
      total: rows.length,
      changes,
      dry_run: dryRun,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bulk update failed" },
      { status: 500 },
    );
  }
}
