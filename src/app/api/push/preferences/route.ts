import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { normalizePushDeviceToken } from "@/lib/push-device-token";

const FIELDS = [
  "task_updates",
  "overdue_updates",
  "clock_reminders",
  "followup_updates",
  "callback_updates",
] as const;
type PreferenceField = (typeof FIELDS)[number];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = normalizePushDeviceToken(req.nextUrl.searchParams.get("token"));
  if (!token) return NextResponse.json({ error: "A valid device token is required" }, { status: 400 });

  const { data, error } = await getSupabase()
    .from("push_tokens")
    .select(FIELDS.join(","))
    .eq("token", token)
    .eq("user_email", user.email.toLowerCase())
    .is("disabled_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load notification preferences" }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "This device is not registered" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { token?: string } & Partial<Record<PreferenceField, unknown>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = normalizePushDeviceToken(body.token);
  if (!token) {
    return NextResponse.json({ error: "A valid device token is required" }, { status: 400 });
  }
  const updates: Partial<Record<PreferenceField, boolean>> = {};
  for (const field of FIELDS) {
    if (typeof body[field] === "boolean") updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid preference was provided" }, { status: 400 });
  }

  const { data, error } = await getSupabase()
    .from("push_tokens")
    .update(updates)
    .eq("token", token)
    .eq("user_email", user.email.toLowerCase())
    .is("disabled_at", null)
    .select(FIELDS.join(","))
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not save notification preferences" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This device is not registered" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
