import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { recordSettingChange, describeListChange } from "@/lib/settings-audit";
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
  const user = await getAuthenticatedUser();
  if (!user || !(await isAdminUser()))
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

  const before = await getNotificationSettings();

  try {
    await putNotificationSettings({ cron_alerts, problems_digest, followup_by_store });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }

  const summary = describeChange(before, { cron_alerts, problems_digest, followup_by_store });
  if (summary) {
    await recordSettingChange({
      area: "notifications",
      actor: user.email ?? "unknown",
      summary,
    });
  }

  return NextResponse.json(await getNotificationSettings());
}

// One sentence covering whichever of the three groups actually moved.
function describeChange(before: NotificationSettings, after: NotificationSettings): string {
  const parts: string[] = [];

  const alerts = describeListChange(before.cron_alerts, after.cron_alerts);
  if (alerts) parts.push(`Failure alerts: ${alerts}`);

  const digest = describeListChange(before.problems_digest, after.problems_digest);
  if (digest) parts.push(`Problem digest: ${digest}`);

  for (const storeId of new Set([
    ...Object.keys(before.followup_by_store),
    ...Object.keys(after.followup_by_store),
  ])) {
    const from = before.followup_by_store[storeId] ?? "";
    const to = after.followup_by_store[storeId] ?? "";
    if (from !== to) {
      parts.push(`Follow-up reminders for ${storeId}: ${from || "nobody"} → ${to || "nobody"}`);
    }
  }

  return parts.join(". ");
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}
