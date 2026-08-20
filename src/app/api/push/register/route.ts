import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";

// Called by the iOS app after APNs hands it a device token. Tokens belong to
// the signed-in employee; a token that changes hands (new login on the same
// phone) is reassigned to the new employee on re-registration.

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { token?: string; platform?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token || token.length < 32 || token.length > 200) {
    return NextResponse.json({ error: "A device token is required" }, { status: 400 });
  }

  const email = user.email.toLowerCase().trim();
  const quoted = quotePostgrestValue(email);
  const { data: employee } = await getSupabase()
    .from("employees")
    .select("id")
    .or(`email.eq.${quoted},email_alt.eq.${quoted}`)
    .eq("active", true)
    .maybeSingle();
  if (!employee) {
    // No employee profile → nothing to notify about; not an error worth
    // surfacing to the user.
    return NextResponse.json({ registered: false });
  }

  const { error } = await getSupabase()
    .from("push_tokens")
    .upsert(
      {
        token,
        employee_id: employee.id,
        user_email: email,
        platform: body.platform === "android" ? "android" : "ios",
        last_registered_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: "token" },
    );
  if (error) {
    console.error("push token upsert failed", error.message);
    return NextResponse.json({ error: "Could not save the device token" }, { status: 500 });
  }
  return NextResponse.json({ registered: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  const { error } = await getSupabase()
    .from("push_tokens")
    .update({ disabled_at: new Date().toISOString() })
    .eq("token", token)
    .eq("user_email", user.email.toLowerCase());
  if (error) {
    console.error("push token disable failed", error.message);
    return NextResponse.json({ error: "Could not remove the device token" }, { status: 500 });
  }
  return NextResponse.json({ removed: true });
}
