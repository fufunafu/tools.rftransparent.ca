import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";

// Development-only shortcut: signs the owner in with one tap so the app can
// be tested in the simulator without Google (blocked in web views) or a
// password. NODE_ENV is "development" only under `next dev` — production
// builds compile this to a permanent 404, and the login page only renders
// the button in dev. Never widen this beyond the owner account.

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { data, error } = await getSupabase().auth.admin.generateLink({
      type: "magiclink",
      email: OWNER_EMAIL,
    });
    if (error || !data?.properties?.hashed_token) {
      return NextResponse.json(
        { error: error?.message ?? "Could not create a dev sign-in token" },
        { status: 500 },
      );
    }
    return NextResponse.json({ tokenHash: data.properties.hashed_token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dev login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
