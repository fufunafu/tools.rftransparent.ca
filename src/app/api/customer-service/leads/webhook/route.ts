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
import { getSupabase } from "@/lib/supabase";
import {
  extractContactFields,
  extractInstallationRequested,
  findOrInsertLead,
  type LeadSource,
} from "@/lib/customer-service/leads";
import {
  LEAD_ATTACHMENT_BUCKET,
  MAX_LEAD_ATTACHMENTS,
  parsePendingAttachments,
  safeAttachmentName,
  validateAttachmentMetadata,
  type PendingLeadAttachment,
} from "@/lib/customer-service/lead-attachments";

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

  if (url.searchParams.get("action") === "create-upload") {
    return createUploadIntent(req);
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
  const installationRequested = extractInstallationRequested(payload);
  const claimedUploads = Array.isArray(payload.uploads) ? payload.uploads : [];
  let pendingAttachments = parsePendingAttachments(claimedUploads);
  if (claimedUploads.length > MAX_LEAD_ATTACHMENTS) {
    await removePendingAttachments(pendingAttachments);
    pendingAttachments = [];
    recordUploadError(payload, `A maximum of ${MAX_LEAD_ATTACHMENTS} drawings can be uploaded.`);
  } else if (pendingAttachments.length !== claimedUploads.length) {
    await removePendingAttachments(pendingAttachments);
    pendingAttachments = [];
    recordUploadError(payload, "One or more drawing references were invalid.");
  } else {
    const verified = await verifyPendingAttachments(pendingAttachments);
    if (!verified.ok) {
      await removePendingAttachments(pendingAttachments);
      pendingAttachments = [];
      recordUploadError(payload, verified.error);
    }
  }

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
    installation_requested: installationRequested,
    raw_payload: payload,
  });

  if (!result.ok) {
    await removePendingAttachments(pendingAttachments);
    return jsonResponse({ error: result.error }, 500);
  }

  if ("skipped" in result) {
    await removePendingAttachments(pendingAttachments);
    return jsonResponse(result);
  }

  if (pendingAttachments.length > 0) {
    const attachmentResult = await attachFilesToLead(result.lead_id, pendingAttachments);
    if (!attachmentResult.ok) {
      return jsonResponse({ error: attachmentResult.error, lead_id: result.lead_id }, 503);
    }
  }

  return jsonResponse({ ...result, attachment_count: pendingAttachments.length });
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function createUploadIntent(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) return jsonResponse({ error: "invalid body" }, 400);

  const validated = validateAttachmentMetadata({
    filename: body.filename,
    content_type: body.content_type,
    size_bytes: body.size_bytes,
  });
  if (!validated.ok) return jsonResponse({ error: validated.error }, 400);

  const path = `incoming/${crypto.randomUUID()}-${safeAttachmentName(validated.filename)}`;
  const { data, error } = await getSupabase()
    .storage
    .from(LEAD_ATTACHMENT_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    const missingBucket = /bucket/i.test(error?.message ?? "");
    return jsonResponse(
      {
        error: missingBucket
          ? `Drawing storage is not set up yet. Apply the lead attachments migration.`
          : error?.message ?? "Could not prepare the drawing upload.",
      },
      missingBucket ? 503 : 500,
    );
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return jsonResponse({ error: "Drawing uploads are not configured." }, 500);

  return jsonResponse({
    signed_url: data.signedUrl,
    path: data.path,
    content_type: validated.contentType,
    upload_headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-upsert": "false",
    },
  });
}

async function verifyPendingAttachments(
  attachments: PendingLeadAttachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = getSupabase().storage.from(LEAD_ATTACHMENT_BUCKET);

  for (const attachment of attachments) {
    const { data, error } = await storage.info(attachment.path);
    if (error || !data) {
      return { ok: false, error: `${attachment.filename} did not finish uploading.` };
    }

    const actualSize = data.size ?? data.metadata?.size;
    const actualType = data.contentType ?? data.metadata?.mimetype;
    if (actualSize !== attachment.size_bytes || actualType !== attachment.content_type) {
      await storage.remove([attachment.path]);
      return { ok: false, error: `${attachment.filename} did not match the uploaded file.` };
    }
  }

  return { ok: true };
}

async function attachFilesToLead(
  leadId: string,
  attachments: PendingLeadAttachment[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase();
  const rows = attachments.map((attachment) => ({
    lead_id: leadId,
    path: attachment.path,
    field_name: attachment.field_name,
    filename: attachment.filename,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
  }));

  const { error } = await supabase
    .from("lead_attachments")
    .upsert(rows, { onConflict: "path", ignoreDuplicates: true });
  if (!error) return { ok: true };

  await removePendingAttachments(attachments);
  const missingTable = /lead_attachments|schema cache|relation/i.test(error.message);
  return {
    ok: false,
    error: missingTable
      ? "The lead was saved, but drawing storage is not ready. Apply the lead attachments migration."
      : `The lead was saved, but its drawing could not be linked: ${error.message}`,
  };
}

async function removePendingAttachments(attachments: PendingLeadAttachment[]): Promise<void> {
  if (attachments.length === 0) return;
  await getSupabase()
    .storage
    .from(LEAD_ATTACHMENT_BUCKET)
    .remove(attachments.map((attachment) => attachment.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordUploadError(payload: Record<string, unknown>, error: string): void {
  const existing = Array.isArray(payload.upload_errors)
    ? payload.upload_errors.filter((value): value is string => typeof value === "string")
    : [];
  payload.upload_errors = [...existing, error];
  payload.uploads = [];
}
