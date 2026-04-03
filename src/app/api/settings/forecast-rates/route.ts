import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function PUT(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { rates } = body as { rates: Record<string, number> };

  if (!rates || typeof rates !== "object")
    return NextResponse.json({ error: "rates object is required" }, { status: 400 });

  const rows = Object.entries(rates).map(([idx, rate]) => ({
    month_index: parseInt(idx, 10),
    mom_rate: rate,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await getSupabase()
    .from("forecast_mom_rates")
    .upsert(rows);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
