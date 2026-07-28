import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Rates for every store at once, shaped as { [storeId]: { [monthIndex]: rate } }.
// The Pipeline dashboard edits one store at a time; Settings → Rates needs
// them side by side.
export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await getSupabase()
    .from("forecast_mom_rates")
    .select("store_id, month_index, mom_rate");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byStore: Record<string, Record<number, number>> = {};
  for (const row of data ?? []) {
    (byStore[row.store_id] ??= {})[row.month_index] = Number(row.mom_rate);
  }
  return NextResponse.json(byStore);
}

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { rates, storeId } = body as { rates: Record<string, number>; storeId: string };

  if (!rates || typeof rates !== "object")
    return NextResponse.json({ error: "rates object is required" }, { status: 400 });
  if (!storeId)
    return NextResponse.json({ error: "storeId is required" }, { status: 400 });

  const rows = Object.entries(rates).map(([idx, rate]) => ({
    store_id: storeId,
    month_index: parseInt(idx, 10),
    mom_rate: rate,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await getSupabase()
    .from("forecast_mom_rates")
    .upsert(rows, { onConflict: "store_id,month_index" });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
