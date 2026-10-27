import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { withCronRun } from "@/lib/automations";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { syncPurchasingSales } from "@/lib/purchasing/sales-sync";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = withCronRun("sync-purchasing-sales", async (req: NextRequest) => {
  if (!isAuthorizedCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await syncPurchasingSales();
  if ("published" in result && result.published) revalidateTag("purchasing", "max");
  const failed = "stores" in result && result.stores.some(s => s.error);
  return NextResponse.json(result, { status: failed ? 502 : 200 });
});
