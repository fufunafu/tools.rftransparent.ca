import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { isAdminEmail } from "@/lib/authz";
import {
  exchangeGmailAuthorizationCode,
  GMAIL_OAUTH_INBOX_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE,
  getGmailProfileEmail,
  INBOXES,
  saveGmailConnection,
} from "@/lib/gmail";
import { syncGmailInbox } from "@/lib/gmail-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function back(
  request: NextRequest,
  status: "success" | "warning" | "error",
  message: string,
): NextResponse {
  const url = new URL("/health-check", request.url);
  url.searchParams.set("gmail_status", status);
  url.searchParams.set("gmail_message", message);
  const response = NextResponse.redirect(url);
  response.cookies.delete(GMAIL_OAUTH_STATE_COOKIE);
  response.cookies.delete(GMAIL_OAUTH_INBOX_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.redirect(new URL("/login", request.url));
  if (!(await isAdminEmail(user.email))) {
    return back(request, "error", "Only an administrator can connect company inboxes.");
  }

  const returnedState = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  const expectedInboxEmail = request.cookies.get(GMAIL_OAUTH_INBOX_COOKIE)?.value.toLowerCase();
  if (!returnedState || !expectedState || returnedState !== expectedState || !expectedInboxEmail) {
    return back(request, "error", "Gmail authorization expired or could not be verified. Try again.");
  }

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return back(request, "error", "Gmail access was not approved. Try again when you are ready.");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return back(request, "error", "Google did not return an authorization code.");

  const inbox = INBOXES.find(
    (candidate) => candidate.email.toLowerCase() === expectedInboxEmail,
  );
  if (!inbox) return back(request, "error", "The selected company inbox is not recognized.");

  try {
    const tokens = await exchangeGmailAuthorizationCode(code);
    const authorizedEmail = await getGmailProfileEmail(tokens.accessToken);
    if (authorizedEmail !== inbox.email.toLowerCase()) {
      return back(
        request,
        "error",
        `You authorized ${authorizedEmail}. Please reconnect and choose ${inbox.email}.`,
      );
    }

    await saveGmailConnection(inbox, tokens.refreshToken, user.email);
    const sync = await syncGmailInbox(inbox);
    if (sync.status === "error") {
      console.error(`[gmail-oauth] Initial sync failed for ${inbox.email}: ${sync.error}`);
      return back(
        request,
        "warning",
        `${inbox.label} is connected, but its first sync failed. Run the health check for details.`,
      );
    }

    return back(
      request,
      "success",
      `${inbox.label} is connected. ${sync.count ?? 0} recent messages were synchronized.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[gmail-oauth] Connection failed for ${inbox.email}: ${message}`);
    return back(request, "error", `Could not connect ${inbox.label}: ${message}`);
  }
}
