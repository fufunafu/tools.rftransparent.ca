import { cookies } from "next/headers";
import crypto from "crypto";

function getSecret(): string {
  const password = process.env.EMPLOYEE_PASSWORD || "1234";
  return password + "_employee_session_secret";
}

export const COOKIE_NAME = "employee_session";
export const EMPLOYEE_ID_COOKIE = "employee_id";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export function createToken(): string {
  const payload = `employee:${Date.now()}`;
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

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export function validatePassword(password: string): boolean {
  const expected = process.env.EMPLOYEE_PASSWORD || "1234";
  if (!password) return false;

  if (password.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(password),
    Buffer.from(expected)
  );
}

export async function setSessionCookie(): Promise<void> {
  const token = createToken();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(EMPLOYEE_ID_COOKIE);
}

export async function isEmployeeAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifyToken(token);
}

export async function setSelectedEmployee(employeeId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_ID_COOKIE, employeeId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getSelectedEmployeeId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(EMPLOYEE_ID_COOKIE)?.value ?? null;
}
