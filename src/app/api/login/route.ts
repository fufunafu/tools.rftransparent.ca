import { NextResponse } from "next/server";
import { validatePassword, createToken, COOKIE_NAME, COOKIE_MAX_AGE_SECONDS } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // Rate limit by IP: 5 attempts per 15-minute window
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const { allowed, retryAfterMs } = rateLimit(`login:${ip}`);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const { password } = await req.json();

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Password is required", code: "MISSING_PASSWORD" },
      { status: 400 }
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "Admin password is not configured on the server", code: "NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  if (!validatePassword(password)) {
    return NextResponse.json(
      { error: "Invalid password", code: "INVALID_PASSWORD" },
      { status: 401 }
    );
  }

  const token = createToken();
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
