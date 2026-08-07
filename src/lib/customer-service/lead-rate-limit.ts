import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

const WINDOW_SECONDS = 10 * 60;

const LIMITS = {
  submit: { client: 10, shop: 300 },
  upload: { client: 30, shop: 600 },
} as const;

export type LeadIngestionKind = keyof typeof LIMITS;

export type LeadRateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; status: 429 | 503; retryAfter: number; error: string };

interface RateLimitRow {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

function privateClientKey(req: NextRequest): string {
  return createHash("sha256").update(clientAddress(req)).digest("hex").slice(0, 24);
}

async function consume(key: string, limit: number): Promise<LeadRateLimitResult> {
  const { data, error } = await getSupabase().rpc(
    "consume_lead_ingestion_rate_limit",
    {
      p_key: key,
      p_limit: limit,
      p_window_seconds: WINDOW_SECONDS,
    },
  );
  if (error) {
    console.error("[lead-ingestion] rate limit unavailable", error.message);
    return {
      ok: false,
      status: 503,
      retryAfter: 30,
      error: "Lead intake is temporarily unavailable.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  if (!row || typeof row.allowed !== "boolean") {
    return {
      ok: false,
      status: 503,
      retryAfter: 30,
      error: "Lead intake is temporarily unavailable.",
    };
  }
  if (!row.allowed) {
    return {
      ok: false,
      status: 429,
      retryAfter: Math.max(1, row.retry_after_seconds),
      error: "Too many lead requests. Please try again shortly.",
    };
  }
  return { ok: true, remaining: Math.max(0, row.remaining) };
}

export async function enforceLeadIngestionRateLimit(
  req: NextRequest,
  shop: string,
  kind: LeadIngestionKind,
): Promise<LeadRateLimitResult> {
  const limits = LIMITS[kind];
  const clientResult = await consume(
    `lead:${kind}:shop:${shop}:client:${privateClientKey(req)}`,
    limits.client,
  );
  if (!clientResult.ok) return clientResult;

  const shopResult = await consume(`lead:${kind}:shop:${shop}`, limits.shop);
  if (!shopResult.ok) return shopResult;

  return {
    ok: true,
    remaining: Math.min(clientResult.remaining, shopResult.remaining),
  };
}
