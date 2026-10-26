import { NextResponse } from "next/server";
import { getOutreachConfig, normalizeInstantlyEvent, OutreachInputError, validWebhookToken } from "@/lib/outreach/domain";
import { readLimitedJson } from "@/lib/outreach/http";
import { ingestOutreachEvent } from "@/lib/outreach/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = getOutreachConfig();
  if (!config) return NextResponse.json({ error: "Outreach is not configured" }, { status: 503 });
  if (!validWebhookToken(request.headers.get("authorization"), config.webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const event = normalizeInstantlyEvent(await readLimitedJson(request), config);
    if (!event) return NextResponse.json({ received: true, ignored: true });
    const result = await ingestOutreachEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof OutreachInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    // A failed commit must be retried by the provider, never acknowledged.
    return NextResponse.json({ error: "Unable to save event" }, { status: 503 });
  }
}
