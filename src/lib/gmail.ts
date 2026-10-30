/**
 * Gmail API client for syncing email metadata.
 * Uses OAuth2 refresh tokens — one per inbox.
 * Reuses the same OAuth app as the Grasshopper OTP fetcher.
 */

import { OAuthTokenSchema } from "@/lib/schemas";
import { getSupabase } from "@/lib/supabase";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";
export const GMAIL_OAUTH_INBOX_COOKIE = "gmail_oauth_inbox";

export interface GmailInbox {
  email: string;
  storeId: string;
  label: string;
  refreshTokenEnv: string; // Legacy environment fallback for the refresh token.
}

export const INBOXES: GmailInbox[] = [
  { email: "info@glass-railing.com", storeId: "rf_transparent", label: "RF Transparent", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_RF" },
  { email: "info@glassrailingstore.com", storeId: "glass_railing_store", label: "Glass Railing Store", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_GRS" },
  { email: "anne@cloture-verre.com", storeId: "bc_transparent", label: "BC Transparent", refreshTokenEnv: "GMAIL_REFRESH_TOKEN_BC" },
];

// Token cache: { [refreshToken]: { accessToken, expiresAt } }
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export interface GmailConnectionStatus {
  inbox: string;
  connected: boolean;
  source: "database" | "environment" | null;
}

interface StoredGmailConnection {
  inbox: string;
  store_id: string;
  label: string;
  refresh_token: string;
  connected_by: string;
  connected_at: string;
}

function gmailConnectionKey(inbox: GmailInbox): string {
  return `gmail_connection:${inbox.email.toLowerCase()}`;
}

async function getStoredGmailConnection(
  inbox: GmailInbox,
): Promise<StoredGmailConnection | null> {
  const { data, error } = await getSupabase()
    .from("app_settings")
    .select("value")
    .eq("key", gmailConnectionKey(inbox))
    .maybeSingle();
  if (error || !data?.value) return null;
  const value = data.value as Partial<StoredGmailConnection>;
  if (typeof value.refresh_token !== "string" || !value.refresh_token) return null;
  return value as StoredGmailConnection;
}

export function gmailOAuthRedirectUri(): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return `${appUrl}/api/oauth/gmail/callback`;
}

export function gmailAuthorizationUrl(inbox: GmailInbox, state: string): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) throw new Error("GMAIL_CLIENT_ID is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailOAuthRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: inbox.email,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGmailAuthorizationCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Gmail OAuth is not configured");

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: gmailOAuthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error_description ?? `Google token exchange failed: ${response.status}`);
  }
  if (!payload?.access_token || !payload.refresh_token) {
    throw new Error("Google did not return offline access. Please reconnect and approve access.");
  }

  tokenCache.set(payload.refresh_token, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  });
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in ?? 3600,
  };
}

export async function getGmailProfileEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Gmail profile failed: ${response.status}`);
  const payload = (await response.json()) as { emailAddress?: string };
  if (!payload.emailAddress) throw new Error("Gmail profile did not return an email address");
  return payload.emailAddress.toLowerCase();
}

export async function saveGmailConnection(
  inbox: GmailInbox,
  refreshToken: string,
  connectedBy: string,
): Promise<void> {
  const now = new Date().toISOString();
  const value: StoredGmailConnection = {
    inbox: inbox.email,
    store_id: inbox.storeId,
    label: inbox.label,
    refresh_token: refreshToken,
    connected_by: connectedBy,
    connected_at: now,
  };
  const { error } = await getSupabase().from("app_settings").upsert(
    {
      key: gmailConnectionKey(inbox),
      value,
      updated_at: now,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(`Could not save Gmail connection: ${error.message}`);
}

export async function getGmailConnectionStatus(
  inbox: GmailInbox,
): Promise<GmailConnectionStatus> {
  try {
    if (await getStoredGmailConnection(inbox)) {
      return { inbox: inbox.email, connected: true, source: "database" };
    }
  } catch {
    // During rollout, keep using the existing environment token fallback.
  }

  if (process.env[inbox.refreshTokenEnv]) {
    return { inbox: inbox.email, connected: true, source: "environment" };
  }
  return { inbox: inbox.email, connected: false, source: null };
}

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

async function getRefreshToken(inbox: GmailInbox): Promise<string> {
  try {
    const connection = await getStoredGmailConnection(inbox);
    if (connection) return connection.refresh_token;
  } catch {
    // Retain the environment fallback if protected settings are unavailable.
  }

  const fallback = process.env[inbox.refreshTokenEnv];
  if (!fallback) throw new Error(`${inbox.label} is not connected`);
  return fallback;
}

export async function checkGmailInbox(inbox: GmailInbox): Promise<string> {
  const accessToken = await getAccessToken(await getRefreshToken(inbox));
  const email = await getGmailProfileEmail(accessToken);
  return `${email} readable`;
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
  const accessToken = await getAccessToken(await getRefreshToken(inbox));
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

export interface GmailConversationMessage {
  id: string; threadId: string; from: string; to: string; subject: string;
  receivedAt: string; body: string; automatic: boolean;
}

// A message-server ID anchors the exact conversation. Never match a sales
// conversation using the prospect address alone.
export async function readGmailConversation(inbox: GmailInbox, messageId: string): Promise<GmailConversationMessage[]> {
  if (!/^[^\s<>"{}]{3,998}$/.test(messageId.replace(/^<|>$/g,''))) throw new Error('Invalid email message ID');
  const token = await getAccessToken(await getRefreshToken(inbox));
  if ((await getGmailProfileEmail(token)).toLowerCase() !== inbox.email.toLowerCase()) throw new Error('Gmail account mismatch');
  const headers = { Authorization: `Bearer ${token}` };
  async function read(path: string) {
    const response = await fetch(`${GMAIL_API}/${path}`, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Gmail conversation unavailable (${response.status})`);
    return response.json();
  }
  const query = new URLSearchParams({ q: `rfc822msgid:${messageId.replace(/^<|>$/g,'')}`, maxResults: '2', includeSpamTrash: 'false' });
  const matches = await read(`messages?${query}`);
  if (matches.messages?.length !== 1 || matches.nextPageToken) throw new Error('Original reply not found uniquely in general inbox');
  const thread = await read(`threads/${encodeURIComponent(matches.messages[0].threadId)}?format=full`);
  if (!Array.isArray(thread.messages) || thread.messages.length > 100) throw new Error('Conversation needs manual review');
  type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: {name:string;value:string}[] };
  function body(part: Part): string {
    if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data,'base64url').toString('utf8');
    return (part.parts ?? []).map(body).filter(Boolean).join('\n');
  }
  return thread.messages.map((message: {id:string;threadId:string;internalDate:string;payload:Part}) => {
    const header=(name:string)=>message.payload.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value??'';
    return {id:message.id,threadId:message.threadId,from:header('From'),to:header('To'),subject:header('Subject'),
      receivedAt:new Date(Number(message.internalDate)).toISOString(),body:body(message.payload).slice(0,20000),
      automatic:Boolean(header('Auto-Submitted') && header('Auto-Submitted').toLowerCase()!=='no') || /^(bulk|list|junk)$/i.test(header('Precedence'))};
  });
}

export interface GmailMessageWithBody {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  receivedAt: string; // ISO timestamp
  body: string; // Plain text; HTML-only messages are converted to text.
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

function partText(part: GmailPart, mimeType: "text/plain" | "text/html"): string {
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const text = partText(child, mimeType);
    if (text) return text;
  }
  return "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * List messages matching a query with their plain-text bodies, oldest first.
 * Includes every inbox tab (Gmail search covers Social and Promotions) but
 * never spam or trash.
 */
export async function readGmailMessages(
  inbox: GmailInbox,
  query: string,
  maxResults = 100,
): Promise<GmailMessageWithBody[]> {
  const accessToken = await getAccessToken(await getRefreshToken(inbox));
  if ((await getGmailProfileEmail(accessToken)).toLowerCase() !== inbox.email.toLowerCase()) {
    throw new Error("Gmail account mismatch");
  }
  const headers = { Authorization: `Bearer ${accessToken}` };

  const messageIds: { id: string }[] = [];
  let pageToken: string | undefined;
  while (messageIds.length < maxResults) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(maxResults - messageIds.length, 100)),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${GMAIL_API}/messages?${params}`, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail list failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    if (data.messages) messageIds.push(...data.messages);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  const messages: GmailMessageWithBody[] = [];
  for (let i = 0; i < messageIds.length; i += 10) {
    const batch = messageIds.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async ({ id }) => {
        const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, { headers, cache: "no-store" });
        if (!res.ok) throw new Error(`Gmail message read failed: ${res.status}`);
        const msg: { id: string; threadId: string; internalDate: string; payload: GmailPart } = await res.json();
        const getHeader = (name: string) =>
          msg.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
        const plain = partText(msg.payload, "text/plain");
        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader("From"),
          subject: getHeader("Subject"),
          receivedAt: new Date(Number(msg.internalDate)).toISOString(),
          body: (plain || htmlToText(partText(msg.payload, "text/html"))).slice(0, 20000),
        };
      }),
    );
    messages.push(...results);
  }

  return messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}
