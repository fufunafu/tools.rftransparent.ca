import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { recordSettingChange } from "@/lib/settings-audit";
import { getWallAnnouncement, putWallAnnouncement } from "@/lib/settings";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// The banner across the top of the office wall board.

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ announcement: await getWallAnnouncement() });
}

/** The editor's display name: their employee record's name, else the email prefix. */
async function displayName(email: string): Promise<string> {
  try {
    const { data } = await getSupabase()
      .from("employees")
      .select("name")
      .ilike("email", email)
      .maybeSingle();
    if (data?.name) return String(data.name).split(/\s+/)[0];
  } catch {
    // Fall through to the email prefix.
  }
  return email.split("@")[0];
}

export async function PUT(req: NextRequest) {
  // Whatever is written here appears on a screen the whole office reads, so
  // editing is admin-only.
  const user = await getAuthenticatedUser();
  if (!user?.email || !(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const message = typeof body.message === "string" ? body.message : "";

  const author = await displayName(user.email);
  await putWallAnnouncement(message, author);

  await recordSettingChange({
    area: "notifications",
    actor: user.email,
    summary: message.trim()
      ? `Wall announcement set: "${message.trim().slice(0, 80)}"`
      : "Wall announcement cleared",
  });

  return NextResponse.json({ announcement: await getWallAnnouncement() });
}
