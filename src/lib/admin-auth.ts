import { cookies } from "next/headers";
import crypto from "crypto";


function getSecret(): string {
  return process.env.ADMIN_PASSWORD! + "_session_secret";
}

export const COOKIE_NAME = "admin_session";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export function createToken(): string {
  const payload = `admin:${Date.now()}`;
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return `${payload}:${hmac}`;
}

function verifyToken(token: string): boolean {
  const parts = token.split(":");
  if (parts.length !== 3) return false;

  const [prefix, timestamp, signature] = parts;
  const payload = `${prefix}:${timestamp}`;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");

  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export function validatePassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password) return false;

  const trimmed = password.trim();
  if (trimmed.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(trimmed),
    Buffer.from(expected)
  );
}

export async function setSessionCookie(): Promise<void> {
  const token = createToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifyToken(token);
}
