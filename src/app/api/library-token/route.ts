import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";

/* Single sign-on for the image library.

   The library is a separate application with its own Supabase project, so a
   session here means nothing there — two databases, two user lists, and a
   token signed by one is refused by the other. That is why signing in to these
   tools still left a sign-in box in front of the library.

   This endpoint closes the gap without moving any data. Somebody already
   signed in here asks for a way in; the library's Supabase mints a one-time
   token for that same address and the page uses it instead of a password.

   Three things keep it narrow:

   - The address comes from the session on this server, never from the request.
     A caller cannot ask for somebody else's token.
   - `magiclink` only works for an account that already exists over there. A
     colleague with no library account gets nothing, so the library's own
     permission ladder still decides who sees what — this only removes the
     password prompt, it does not grant access.
   - The service key stays on the server. What reaches the browser is a token
     that is good once, for one account, for a few minutes. */

const LIBRARY_URL = "https://fojxkzruurdhzllsgiur.supabase.co";

export async function GET() {
  const key = process.env.LIBRARY_SUPABASE_SERVICE_KEY;
  // Not configured is not an error the browser should dress up: the page falls
  // back to its own sign-in box, which is exactly what it did before.
  if (!key) {
    return NextResponse.json({ error: "Library sign-on is not switched on" }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(`${LIBRARY_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ type: "magiclink", email: user.email.toLowerCase() }),
    });

    if (!res.ok) {
      // The common case is "no account over there", and it is not a failure —
      // it is the answer. The page shows its sign-in box.
      return NextResponse.json({ error: "No library account for this address" }, { status: 404 });
    }

    const link = await res.json();
    const hash = link?.hashed_token ?? link?.properties?.hashed_token ?? null;
    if (!hash) {
      return NextResponse.json({ error: "No token in the reply" }, { status: 502 });
    }

    // Only the hash travels. The action link Supabase also returns would carry
    // a redirect and a refresh token in the URL; the page does not need either.
    return NextResponse.json(
      { token_hash: hash },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not reach the library" }, { status: 502 });
  }
}
