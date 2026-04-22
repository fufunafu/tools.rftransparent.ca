import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import { getMonthlyHistory } from "@/lib/kpi-sales";

function getMatchTags(emp: { name: string; shopify_tags?: string[] | null }): string[] {
  const configured = (emp.shopify_tags ?? [])
    .map((t: string) => t.toLowerCase())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const name = emp.name.trim().toLowerCase();
  const parts = name.split(/\s+/);
  return [...new Set([name, ...parts])];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const months = parseInt(req.nextUrl.searchParams.get("months") ?? "12", 10) || 12;

  const { data: emp, error } = await getSupabase()
    .from("employees")
    .select("id, name, department, shopify_tags, active")
    .eq("id", id)
    .single();

  if (error || !emp)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  if (emp.department !== "sales") {
    return NextResponse.json({ employee: emp, history: [] });
  }

  const stores = getStores();
  const rfStore = stores.find((s) => s.label === "RF Transparent");
  const salesStoreIds = rfStore ? [rfStore.id] : stores.map((s) => s.id);

  const matchTags = getMatchTags(emp);
  const history = await getMonthlyHistory(matchTags, salesStoreIds, months);

  return NextResponse.json({ employee: emp, history });
}
