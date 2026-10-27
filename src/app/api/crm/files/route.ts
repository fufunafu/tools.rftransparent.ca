import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { canAccessCrm } from "@/lib/crm/access";
import { getSupabase } from "@/lib/supabase";
import { CRM_ASSET_BUCKET } from "@/lib/crm/assets.mjs";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await getAuthenticatedUser())?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!(await canAccessCrm())) return NextResponse.json({ error: "CRM access required" }, { status: 403, headers });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^hubspot:\d+:(?:file:\d+|recording:[a-f0-9]{64})$/.test(id)) return NextResponse.json({ error: "Invalid file" }, { status: 400, headers });
  const db = getSupabase();
  const result = await db.from("crm_assets").select("storage_path,filename").eq("id", id).eq("status", "ready").maybeSingle();
  if (result.error || !result.data?.storage_path) return NextResponse.json({ error: "This file has not been copied yet." }, { status: 404, headers });
  // A short-lived download link keeps large binaries out of function responses.
  // The bucket is private and all uploads use octet-stream; force attachment download.
  const signed = await db.storage.from(CRM_ASSET_BUCKET).createSignedUrl(result.data.storage_path, 60, { download: result.data.filename || "attachment" });
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: "Download unavailable" }, { status: 503, headers });
  return new Response(null, { status: 303, headers: { ...headers, Location: signed.data.signedUrl, "Referrer-Policy": "no-referrer" } });
}
