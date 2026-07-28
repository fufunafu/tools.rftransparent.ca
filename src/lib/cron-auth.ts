import type { NextRequest } from "next/server";

// /api/cron/* is publicly reachable (allowlisted in proxy.ts), so the
// Authorization header is the only gate. Fail closed: a missing CRON_SECRET
// means nobody is authorized, not everybody. Vercel's cron scheduler sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is set.
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return req.headers.get("authorization") === `Bearer ${cronSecret}`;
}
