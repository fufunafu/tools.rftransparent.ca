import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSalesOverview, getSalesSources, getSalesStatus } from "@/lib/purchasing/sales-queries";
import { getSupabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!(await isManagementUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    if (req.nextUrl.searchParams.has("status")) return NextResponse.json(await getSalesStatus());
    if (req.nextUrl.searchParams.has("sources")) return NextResponse.json({ sources: await getSalesSources(req.nextUrl.searchParams.get("product_id") || undefined) });
    return NextResponse.json(await getSalesOverview());
  } catch {
    return NextResponse.json({ error: "Sales history is temporarily unavailable. Previous purchasing values are retained." }, { status: 503 });
  }
}
const reviewSchema = z.object({ source_key: z.string().regex(/^[a-f0-9]{64}$/), product_id: z.string().uuid().nullable(), unit_multiplier: z.number().positive().max(10000) });
export async function POST(req: NextRequest) {
  if (!(await isManagementUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Reviewer identity required" }, { status: 403 });
  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a product and a positive unit conversion, or exclude this source." }, { status: 400 });
  const body = parsed.data;
  const { data, error } = await getSupabase().rpc("purchasing_sales_review", { p_source: body.source_key, p_product: body.product_id, p_multiplier: body.unit_multiplier, p_actor: user.email.toLowerCase() });
  if (error) return NextResponse.json({ error: "Could not save the match. Please refresh and try again." }, { status: 500 });
  revalidateTag("purchasing", "max");
  return NextResponse.json({ saved: true, published: data });
}
