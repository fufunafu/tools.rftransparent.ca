// Meta lead-ads webhook.
//
// Flow:
//   1. GET  — verification handshake. Meta sends ?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...
//      and we echo back the challenge if the token matches.
//   2. POST — a signed notification for each new lead. The payload contains
//      a `leadgen_id`; we call the Graph API with our Page Access Token to
//      fetch the actual lead data, then insert via `findOrInsertLead`.
//
// Required env vars:
//   META_WEBHOOK_VERIFY_TOKEN — any random string; the same value must be
//                               entered in the Meta App Dashboard → Webhooks.
//   META_APP_SECRET           — App Secret from the Meta App's Basic settings.
//                               Used to verify the X-Hub-Signature-256 header.
//   META_PAGE_ACCESS_TOKEN    — Page Access Token (with `leads_retrieval`,
//                               `pages_show_list`, `pages_read_engagement`)
//                               for the Facebook Page running the ads.
//   META_GRAPH_API_VERSION    — optional; defaults to "v21.0".

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  extractMetaLeadFields,
  findOrInsertLead,
} from "@/lib/customer-service/leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? "v21.0";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) {
    return new NextResponse("not configured", { status: 500 });
  }
  if (mode === "subscribe" && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!appSecret || !pageAccessToken) {
    return NextResponse.json(
      { error: "Meta webhook not configured (missing META_APP_SECRET or META_PAGE_ACCESS_TOKEN)" },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(rawBody, sigHeader, appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const entries =
    isRecord(payload) && Array.isArray(payload.entry) ? payload.entry : [];

  const results: Array<{
    leadgen_id: string;
    ok: boolean;
    lead_id?: string;
    deduped?: boolean;
    skipped?: string;
    error?: string;
  }> = [];

  for (const entry of entries) {
    const changes = isRecord(entry) && Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isRecord(change) || change.field !== "leadgen") continue;
      const value = isRecord(change.value) ? change.value : null;
      if (!value) continue;

      const leadgenId = typeof value.leadgen_id === "string" ? value.leadgen_id : null;
      if (!leadgenId) continue;

      const processed = await processLead(leadgenId, value, pageAccessToken);
      results.push({ leadgen_id: leadgenId, ...processed });
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    // A non-2xx response asks Meta to retry. findOrInsertLead is idempotent,
    // so successfully processed entries remain safe when the batch repeats.
    console.error("[meta-leads] webhook processing failed", failed);
    return NextResponse.json(
      { ok: false, processed: results.length, failed: failed.length, results },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function processLead(
  leadgenId: string,
  changeValue: Record<string, unknown>,
  pageAccessToken: string,
): Promise<{
  ok: boolean;
  lead_id?: string;
  deduped?: boolean;
  skipped?: string;
  error?: string;
}> {
  const formIdFromEvent =
    typeof changeValue.form_id === "string" ? changeValue.form_id : null;

  let leadData: Record<string, unknown> | null = null;
  try {
    const leadRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
        leadgenId,
      )}?access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (!leadRes.ok) {
      const detail = await leadRes.text();
      return { ok: false, error: `Graph API ${leadRes.status}: ${detail.slice(0, 200)}` };
    }
    leadData = (await leadRes.json()) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Graph API fetch failed" };
  }

  const formId =
    (typeof leadData.form_id === "string" ? leadData.form_id : null) ?? formIdFromEvent;

  // Best-effort: fetch the form's display name so source_detail is readable.
  let formName: string | null = null;
  if (formId) {
    try {
      const formRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
          formId,
        )}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`,
      );
      if (formRes.ok) {
        const fd = (await formRes.json()) as { name?: unknown };
        if (typeof fd.name === "string" && fd.name.trim()) formName = fd.name.trim();
      }
    } catch {
      // Non-fatal; we fall back to the form id.
    }
  }

  const fieldData = Array.isArray(leadData.field_data)
    ? (leadData.field_data as Array<{ name?: unknown; values?: unknown }>)
    : [];
  const { name, email, phone, message } = extractMetaLeadFields(fieldData);

  const sourceDetail = formName ?? (formId ? `Meta form ${formId}` : null);

  const result = await findOrInsertLead({
    source: "meta",
    source_detail: sourceDetail,
    form_id: formId,
    page_url: null,
    name,
    email,
    phone,
    message,
    external_id: leadgenId,
    submitted_at:
      typeof leadData.created_time === "string" ? leadData.created_time : null,
    raw_payload: { meta_lead_id: leadgenId, event: changeValue, lead: leadData },
  });

  if (!result.ok && "error" in result) {
    return { ok: false, error: result.error };
  }
  if ("skipped" in result) {
    return { ok: true, skipped: result.skipped };
  }
  return { ok: true, lead_id: result.lead_id, deduped: result.deduped };
}

function verifySignature(body: string, header: string, secret: string): boolean {
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
