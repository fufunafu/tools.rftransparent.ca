import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";
import { testLoginRequestAllowed } from "@/lib/test-login";

// Local-only shortcut: signs the owner in with one tap so the app can be
// tested without Google (blocked in web views) or a password. It is enabled
// automatically by `next dev`, or explicitly with ENABLE_TEST_LOGIN=1 for a
// local production build. The request must still originate on a loopback host.
// Never widen this beyond the owner account.

export async function POST(request: Request) {
  if (!testLoginRequestAllowed(request.url)) {
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
