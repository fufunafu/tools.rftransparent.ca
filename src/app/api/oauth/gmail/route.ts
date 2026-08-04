import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { isAdminEmail } from "@/lib/authz";
import {
  GMAIL_OAUTH_INBOX_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE,
  gmailAuthorizationUrl,
  INBOXES,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";

function configurationError(request: NextRequest): NextResponse {
  const url = new URL("/health-check", request.url);
  url.searchParams.set("gmail_status", "error");
  url.searchParams.set(
    "gmail_message",
    "Gmail OAuth is not configured. Review the Gmail environment settings and try again.",
  );
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedInbox = request.nextUrl.searchParams.get("inbox")?.toLowerCase();
  const inbox = INBOXES.find((candidate) => candidate.email.toLowerCase() === requestedInbox);
  if (!inbox) {
    return NextResponse.json({ error: "Unknown Gmail inbox" }, { status: 400 });
  }
  if (
    !process.env.GMAIL_CLIENT_ID
    || !process.env.GMAIL_CLIENT_SECRET
    || !process.env.NEXT_PUBLIC_APP_URL
  ) {
    return configurationError(request);
  }

  const state = randomBytes(24).toString("hex");
  let authorizationUrl: string;
  try {
    authorizationUrl = gmailAuthorizationUrl(inbox, state);
  } catch {
    return configurationError(request);
  }
  const response = NextResponse.redirect(authorizationUrl);
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 10 * 60,
    path: "/",
  };
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(GMAIL_OAUTH_INBOX_COOKIE, inbox.email, cookieOptions);
  return response;
}
