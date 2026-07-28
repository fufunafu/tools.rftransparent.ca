import { NextRequest, NextResponse } from "next/server";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import {
  getNotificationSettings,
  putNotificationSettings,
  looksLikeEmail,
  type NotificationSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getNotificationSettings());
}

export async function PUT(req: NextRequest) {
  // Changing where alerts land is an admin-level action — an employee who
  // can read the page shouldn't be able to redirect the owner's alerts.
  if (!(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Partial<NotificationSettings> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const cron_alerts = cleanList(body.cron_alerts);
  const problems_digest = cleanList(body.problems_digest);
  const followup_by_store: Record<string, string> = {};
  for (const [storeId, email] of Object.entries(body.followup_by_store ?? {})) {
    const trimmed = String(email ?? "").trim();
    // An empty box means "don't email this store" — a valid choice.
    if (!trimmed) continue;
    if (!looksLikeEmail(trimmed))
      return NextResponse.json({ error: `"${trimmed}" is not a valid email address.` }, { status: 400 });
    followup_by_store[storeId] = trimmed;
  }

  const bad = [...cron_alerts, ...problems_digest].find((e) => !looksLikeEmail(e));
  if (bad) return NextResponse.json({ error: `"${bad}" is not a valid email address.` }, { status: 400 });

  // Losing every failure-alert recipient would make crons silent again —
  // the exact problem this alerting was built to fix.
  if (cron_alerts.length === 0)
    return NextResponse.json(
      { error: "Keep at least one address for failure alerts." },
      { status: 400 }
    );

  try {
    await putNotificationSettings({ cron_alerts, problems_digest, followup_by_store });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }

  return NextResponse.json(await getNotificationSettings());
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}
