// Public webhook endpoint that receives form submissions from the customer's
// browser via the "After form loaded" script in Powerful Form Builder.
//
// Meta lead-ad webhooks have a different shape (signed POST, then a Graph API
// callback to fetch the data) and live at /api/customer-service/leads/meta-webhook.
//
// Auth: a shared secret in the ?secret=... query param. The secret is visible
// in the browser's network tab, so it stops drive-by spam but isn't a strong
// authorization gate — sufficient for now.
//
// CORS: this is invoked cross-origin from the Shopify storefront, so we accept
// any origin. The secret is the gate.

import { NextRequest, NextResponse } from "next/server";
import {
  extractContactFields,
  findOrInsertLead,
  type LeadSource,
} from "@/lib/customer-service/leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const expected = process.env.LEADS_WEBHOOK_SECRET;
  if (!expected) {
    return jsonResponse({ error: "Webhook not configured (missing LEADS_WEBHOOK_SECRET)" }, 500);
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const sourceParam = url.searchParams.get("source");
  const source: LeadSource = sourceParam === "meta" ? "meta" : "website";

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    // Fall back to form-encoded
    try {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const fields: Record<string, string> = {};
      params.forEach((v, k) => { fields[k] = v; });
      payload = { fields };
    } catch {
      return jsonResponse({ error: "invalid body" }, 400);
    }
  }

  const { name, email, phone, message } = extractContactFields(payload);

  const sourceDetail =
    pickStr(payload, "source_detail") ??
    pickStr(payload, "form_name") ??
    pickStr(payload, "page_url") ??
    null;

  const result = await findOrInsertLead({
    source,
    source_detail: sourceDetail,
    form_id: pickStr(payload, "form_id"),
    page_url: pickStr(payload, "page_url"),
    name,
    email,
    phone,
    message,
    raw_payload: payload,
  });

  if (!result.ok) {
    return jsonResponse({ error: result.error }, 500);
  }
  return jsonResponse(result);
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
