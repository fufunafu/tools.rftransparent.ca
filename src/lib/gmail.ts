/**
 * Gmail API client for syncing email metadata.
 * Uses OAuth2 refresh tokens — one per inbox.
 * Reuses the same OAuth app as the Grasshopper OTP fetcher.
 */

import { OAuthTokenSchema } from "@/lib/schemas";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailInbox {
  email: string;
  storeId: string;
  label: string;
  refreshTokenEnv: string; // env var name holding the refresh token
}

export const INBOXES: GmailInbox[] = [
  { email: "info@glass-railing.com", storeId: "rf_transparent", label: "RF Transparent", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_RF" },
  { email: "info@glassrailingstore.com", storeId: "glass_railing_store", label: "Glass Railing Store", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_GRS" },
  { email: "anne@cloture-verre.com", storeId: "bc_transparent", label: "BC Transparent", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_BC" },
];

// Token cache: { [refreshToken]: { accessToken, expiresAt } }
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not set");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token refresh failed: ${res.status} ${body}`);
  }

  const raw = await res.json();
  const data = OAuthTokenSchema.parse(raw);
  tokenCache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });

  return data.access_token;
}

function getRefreshToken(inbox: GmailInbox): string {
  const token = process.env[inbox.refreshTokenEnv];
  if (!token) throw new Error(`${inbox.refreshTokenEnv} not set`);
  return token;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string; // ISO timestamp
  snippet: string;
}

/**
 * List messages from a Gmail inbox matching a query.
 * Returns metadata only (no body content).
 */
export async function listMessages(
  inbox: GmailInbox,
  query: string,
  maxResults = 500,
): Promise<GmailMessage[]> {
  const accessToken = await getAccessToken(getRefreshToken(inbox));
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Paginate through message IDs
  const messageIds: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  while (messageIds.length < maxResults) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(maxResults - messageIds.length, 100)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${GMAIL_API}/messages?${params}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail list failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    if (data.messages) {
      messageIds.push(...data.messages);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  // Fetch metadata for each message (batch in parallel, 10 at a time)
  const messages: GmailMessage[] = [];
  for (let i = 0; i < messageIds.length; i += 10) {
    const batch = messageIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async ({ id }) => {
        const res = await fetch(`${GMAIL_API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { headers });
        if (!res.ok) return null;
        const msg = await res.json();

        const getHeader = (name: string) =>
          msg.payload?.headers?.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader("From"),
          to: getHeader("To"),
          subject: getHeader("Subject"),
          date: getHeader("Date"),
          snippet: msg.snippet ?? "",
        } as GmailMessage;
      }),
    );
    messages.push(...results.filter((m): m is GmailMessage => m !== null));
  }

  return messages;
}

/**
 * Determine if a message is inbound or outbound relative to the inbox email.
 */
export function classifyDirection(msg: GmailMessage, inboxEmail: string): "inbound" | "outbound" {
  const fromLower = msg.from.toLowerCase();
  // If the From contains the inbox email, it's outbound (staff sent it)
  if (fromLower.includes(inboxEmail.toLowerCase())) {
    return "outbound";
  }
  return "inbound";
}

/**
 * Extract just the email address from a "Name <email>" string.
 */
export function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : raw.toLowerCase().trim();
}
