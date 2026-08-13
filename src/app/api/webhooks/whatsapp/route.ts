import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return new NextResponse("not configured", { status: 500 });
  if (mode === "subscribe" && token === expected && challenge) {
    return new NextResponse(challenge, { headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  const body = await request.text();
  if (!verifySignature(body, request.headers.get("x-hub-signature-256") ?? "", secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const statuses = extractStatuses(payload);
  let updated = 0;
  for (const status of statuses) {
    const timestamp = status.timestamp && /^\d+$/.test(status.timestamp)
      ? new Date(Number(status.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const failure = status.errors?.map((error) => error.title || error.message).filter(Boolean).join("; ") || null;
    const { data: recipient } = await getSupabase()
      .from("survey_recipients")
      .select("id,delivery_status,completed_at,opened_at")
      .or(`provider_message_id.eq.${quotePostgrestValue(status.id)},reminder_message_id.eq.${quotePostgrestValue(status.id)}`)
      .maybeSingle();
    if (!recipient) {
      const { data: actionDelivery } = await getSupabase()
        .from("survey_action_deliveries")
        .select("id,status")
        .eq("provider_message_id", status.id)
        .maybeSingle();
      if (!actionDelivery) continue;
      const changes: Record<string, unknown> = { updated_at: timestamp };
      if (status.status === "delivered" || status.status === "read") {
        changes.status = "delivered";
        changes.delivered_at = timestamp;
      } else if (status.status === "failed") {
        changes.status = "failed";
        changes.delivery_error = failure ?? "WhatsApp delivery failed";
      }
      const { error } = await getSupabase().from("survey_action_deliveries").update(changes).eq("id", actionDelivery.id);
      if (!error) updated += 1;
      continue;
    }

    const changes: Record<string, unknown> = { updated_at: timestamp };
    if (status.status === "delivered" || status.status === "read") {
      changes.delivered_at = timestamp;
      if (!recipient.completed_at && !recipient.opened_at) changes.delivery_status = "delivered";
    } else if (status.status === "failed") {
      changes.delivery_error = failure ?? "WhatsApp delivery failed";
      if (!recipient.completed_at && !recipient.opened_at) changes.delivery_status = "failed";
    }
    const { error } = await getSupabase().from("survey_recipients").update(changes).eq("id", recipient.id);
    if (!error) updated += 1;
  }
  return NextResponse.json({ received: statuses.length, updated });
}

interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp?: string;
  errors?: Array<{ title?: string; message?: string }>;
}

function extractStatuses(payload: unknown): WhatsAppStatus[] {
  if (!payload || typeof payload !== "object" || !("entry" in payload) || !Array.isArray(payload.entry)) return [];
  const statuses: WhatsAppStatus[] = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== "object" || !("changes" in entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || typeof change !== "object" || !("value" in change) || !change.value || typeof change.value !== "object") continue;
      if (!("statuses" in change.value) || !Array.isArray(change.value.statuses)) continue;
      for (const status of change.value.statuses) {
        if (status && typeof status === "object" && "id" in status && "status" in status && typeof status.id === "string" && typeof status.status === "string") {
          statuses.push(status as WhatsAppStatus);
        }
      }
    }
  }
  return statuses;
}

function verifySignature(body: string, header: string, secret: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const provided = header.slice(7);
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(provided, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
