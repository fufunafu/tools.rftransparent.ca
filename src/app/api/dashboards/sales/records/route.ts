import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSalesRepRecords } from "@/lib/dashboard-sales-records";
import { SALES_PERIODS } from "@/lib/sales-periods";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const repId = request.nextUrl.searchParams.get("repId");
  const period = SALES_PERIODS.find((entry) => entry.id === request.nextUrl.searchParams.get("period"));
  const kind = request.nextUrl.searchParams.get("kind");
  if (!repId || !period || (kind !== "orders" && kind !== "quotes")) {
    return NextResponse.json({ error: "Select a sales representative, period and record type." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getSalesRepRecords(repId, period.id, kind), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[sales records]", error);
    return NextResponse.json({ error: "Could not load the complete list. Please try again." }, { status: 502 });
  }
}
