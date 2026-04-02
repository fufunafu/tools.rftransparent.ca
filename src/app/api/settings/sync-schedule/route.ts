import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SETTING_KEY = "sync_schedule";
const DEFAULT_SCHEDULE = { enabled: true, hours: [8, 17], timezone: "America/New_York" };

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await getSupabase()
    .from("app_settings")
    .select("value")
    .eq("key", SETTING_KEY)
    .limit(1);

  return NextResponse.json(data?.[0]?.value ?? DEFAULT_SCHEDULE);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const schedule = {
    enabled: Boolean(body.enabled),
    hours: (body.hours as number[]).filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b),
    timezone: body.timezone || "America/New_York",
  };

  const { error } = await getSupabase()
    .from("app_settings")
    .upsert({ key: SETTING_KEY, value: schedule, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(schedule);
}
