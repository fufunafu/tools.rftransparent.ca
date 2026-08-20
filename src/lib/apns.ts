import "server-only";

import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";

// Minimal APNs client: ES256 provider JWT + one HTTP/2 request per token.
// Vercel functions are short-lived, so a fresh connection per invocation is
// fine; the JWT is cached for ~50 minutes (Apple allows 20–60).
//
// Env: APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY (the .p8 contents,
// newlines as \n allowed), APNS_TOPIC (bundle id), APNS_USE_SANDBOX=1 for
// Xcode dev builds. TestFlight and App Store builds use production APNs.

export interface PushMessage {
  title: string;
  body: string;
  // Deep-link hint the app can read from the notification tap.
  url?: string;
}

export interface PushResult {
  token: string;
  ok: boolean;
  status: number;
  // APNs "reason" string, e.g. "Unregistered" | "BadDeviceToken".
  reason?: string;
}

let cachedJwt: { value: string; expiresAt: number } | null = null;

async function providerJwt(): Promise<string> {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const rawKey = process.env.APNS_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) {
    throw new Error("APNs is not configured (APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY)");
  }
  if (cachedJwt && cachedJwt.expiresAt > Date.now()) return cachedJwt.value;

  const key = await importPKCS8(rawKey.replace(/\\n/g, "\n"), "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
  cachedJwt = { value, expiresAt: Date.now() + 50 * 60 * 1000 };
  return value;
}

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
}

/** Tokens Apple reported as dead (safe to disable in the database). */
export function deadTokens(results: PushResult[]): string[] {
  return results
    .filter((r) => r.status === 410 || r.reason === "Unregistered" || r.reason === "BadDeviceToken")
    .map((r) => r.token);
}

export async function sendPush(tokens: string[], message: PushMessage): Promise<PushResult[]> {
  if (tokens.length === 0) return [];
  const jwt = await providerJwt();
  const topic = process.env.APNS_TOPIC ?? "ca.rftransparent.tools";
  const host = process.env.APNS_USE_SANDBOX === "1"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

  const payload = JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
    },
    ...(message.url ? { url: message.url } : {}),
  });

  const client = http2.connect(host);
  try {
    return await Promise.all(
      tokens.map(
        (token) =>
          new Promise<PushResult>((resolve) => {
            const req = client.request({
              ":method": "POST",
              ":path": `/3/device/${token}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": topic,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            });
            let status = 0;
            let body = "";
            req.on("response", (headers) => {
              status = Number(headers[":status"] ?? 0);
            });
            req.on("data", (chunk) => {
              body += chunk;
            });
            req.on("end", () => {
              let reason: string | undefined;
              try {
                reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
              } catch {
                // Non-JSON error body; the status code is enough.
              }
              resolve({ token, ok: status === 200, status, reason });
            });
            req.on("error", () => resolve({ token, ok: false, status: 0, reason: "network" }));
            req.setTimeout(10_000, () => req.close());
            req.end(payload);
          }),
      ),
    );
  } finally {
    client.close();
  }
}
