import { NextRequest, NextResponse } from "next/server";
import { isManagementUser } from "@/lib/admin-auth";
import { listActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const productId = req.nextUrl.searchParams.get("product_id") ?? undefined;
  const orderId = req.nextUrl.searchParams.get("order_id") ?? undefined;
  const limit = Math.min(
    200,
    parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50,
  );
  try {
    const events = await listActivity({ productId, orderId, limit });
    return NextResponse.json({ events });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load activity",
      },
      { status: 500 },
    );
  }
}
