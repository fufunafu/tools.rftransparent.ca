import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";
import { normalizePushDeviceToken } from "@/lib/push-device-token";

// Called by the iOS app after APNs hands it a device token. Tokens belong to
// the signed-in employee; a token that changes hands (new login on the same
// phone) is reassigned to the new employee on re-registration.

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    token?: string;
    previous_token?: string | null;
    platform?: string;
    apns_environment?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = normalizePushDeviceToken(body.token);
  if (!token) {
    return NextResponse.json({ error: "A device token is required" }, { status: 400 });
  }
  const previousToken = body.previous_token == null
    ? null
    : normalizePushDeviceToken(body.previous_token);
  if (body.previous_token != null && !previousToken) {
    return NextResponse.json({ error: "The previous device token is invalid" }, { status: 400 });
  }
  const apnsEnvironment = body.apns_environment;
  if (apnsEnvironment !== "sandbox" && apnsEnvironment !== "production") {
    return NextResponse.json({ error: "A valid APNs environment is required" }, { status: 400 });
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
        apns_environment: apnsEnvironment,
        last_registered_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: "token" },
    );
  if (error) {
    console.error("push token upsert failed", error.message);
    return NextResponse.json({ error: "Could not save the device token" }, { status: 500 });
  }
  if (previousToken && previousToken !== token) {
    // The token is supplied by the registering device from its local record.
    // Do not scope rotation cleanup to the current email: the same phone may
    // now belong to a different employee after an earlier sign-out cleanup
    // failed. Leaving that previous row active could send work notifications
    // for the former account to a stale APNs registration.
    const { error: rotationError } = await getSupabase()
      .from("push_tokens")
      .update({ disabled_at: new Date().toISOString() })
      .eq("token", previousToken);
    if (rotationError) {
      console.error("previous push token disable failed", rotationError.message);
      return NextResponse.json({ error: "Could not rotate the device token" }, { status: 500 });
    }
  }
  return NextResponse.json({ registered: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = normalizePushDeviceToken(req.nextUrl.searchParams.get("token"));
  if (!token) return NextResponse.json({ error: "A valid token is required" }, { status: 400 });

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
