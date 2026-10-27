import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { refreshSalesDashboardSnapshot } from "@/lib/sales-dashboard-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await refreshSalesDashboardSnapshot());
}

export const GET = withCronRun("refresh-sales-dashboard", handler);
