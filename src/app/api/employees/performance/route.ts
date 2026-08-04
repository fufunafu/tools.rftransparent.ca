import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import {
  getEmployeePerformance,
  getPerformanceStoreOptions,
} from "@/lib/employee-performance-data";
import {
  PERFORMANCE_RANGES,
  type PerformanceRange,
} from "@/lib/employee-performance";

export const dynamic = "force-dynamic";

function isPerformanceRange(value: string | null): value is PerformanceRange {
  return PERFORMANCE_RANGES.includes(value as PerformanceRange);
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const value = request.nextUrl.searchParams.get("range");
  const range: PerformanceRange = isPerformanceRange(value) ? value : "7d";
  const stores = getPerformanceStoreOptions();
  if (stores.length === 0) {
    return NextResponse.json({ error: "No Shopify stores are configured" }, { status: 500 });
  }
  const requestedStoreId = request.nextUrl.searchParams.get("store");
  const store = requestedStoreId
    ? stores.find((candidate) => candidate.id === requestedStoreId)
    : stores[0];
  if (!store) {
    return NextResponse.json({ error: "Unknown store" }, { status: 400 });
  }

  try {
    const performance = await getEmployeePerformance(range, store.id);
    return NextResponse.json(performance);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Performance data could not be loaded";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
