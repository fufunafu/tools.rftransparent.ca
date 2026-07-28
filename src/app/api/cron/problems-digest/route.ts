import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/automations";
import { getSupabase } from "@/lib/supabase";
import { getResend } from "@/lib/resend";
import { typeLabel, type ProblemTicket } from "@/lib/problem-tickets";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { reportCronFailure } from "@/lib/cron-monitor";
import { getNotificationSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly Monday-morning digest of problem tickets. The point is adoption:
// even in a week when nobody opens /problems, the open list (with names and
// ages) lands in the inbox, so stale tickets can't quietly rot.
// Recipients live in Settings → Notifications; the default there matches the
// address this digest has always used.

const STALE_DAYS = 7;

function torontoDateString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// "2026-07-20" + n days -> "2026-07-25" (noon UTC avoids DST edge cases).
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  return Math.round(
    (new Date(toDateStr + "T12:00:00Z").getTime() - new Date(fromDateStr + "T12:00:00Z").getTime()) /
      86400000
  );
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function buildEmailHtml(opts: {
  open: ProblemTicket[];
  staleIds: Set<string>;
  openedLastWeek: number;
  resolvedLastWeek: number;
  today: string;
}): string {
  const { open, staleIds, openedLastWeek, resolvedLastWeek, today } = opts;
  const shown = open.slice(0, 30);

  const rows = shown
    .map((t) => {
      const stale = staleIds.has(t.id);
      const age = daysBetween(t.ticket_date, today);
      return `<tr style="border-bottom:1px solid #eee${stale ? ";background:#fef2f2" : ""}">
        <td style="padding:8px;font-weight:500">${escapeHtml(t.client_name)}</td>
        <td style="padding:8px">${escapeHtml(typeLabel(t.type))}</td>
        <td style="padding:8px">${escapeHtml(t.person || "—")}</td>
        <td style="padding:8px;text-align:right;${stale ? "color:#dc2626;font-weight:600" : ""}">${age}d</td>
        <td style="padding:8px;color:#64748b">${escapeHtml(truncate(t.issue || "—", 90))}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="color:#1e293b;margin-bottom:4px">Problem Tickets — Weekly Digest</h2>
      <p style="color:#64748b;margin-top:0">
        <span style="font-weight:600;color:${open.length > 0 ? "#dc2626" : "#16a34a"}">${open.length} open</span>
        ${staleIds.size > 0 ? ` · <span style="color:#dc2626">${staleIds.size} untouched for ${STALE_DAYS}+ days</span>` : ""}
        · ${openedLastWeek} opened last week · ${resolvedLastWeek} resolved last week
      </p>
      ${
        open.length === 0
          ? `<p style="color:#16a34a;font-weight:500">No open tickets. 🎉</p>`
          : `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Client</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Type</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Person</th>
            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;color:#94a3b8">Open</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Next step</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
      }
      ${open.length > shown.length ? `<p style="color:#94a3b8;font-size:12px;margin-top:8px">Showing oldest ${shown.length} of ${open.length} open tickets</p>` : ""}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">
        Rows in red have had no activity for ${STALE_DAYS}+ days.
        Manage tickets at <a href="https://tools.rftransparent.ca/customer-service/problems" style="color:#3b82f6">tools.rftransparent.ca/customer-service/problems</a>
      </p>
    </div>
  `;
}

async function handler(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = torontoDateString(new Date());
  // Runs Monday morning; the reporting window is the previous Mon-Sun week.
  const weekday = new Date(today + "T12:00:00Z").getUTCDay(); // Mon = 1
  const thisMonday = addDays(today, -((weekday + 6) % 7));
  const lastMonday = addDays(thisMonday, -7);

  const [{ data: open, error: openErr }, { count: openedLastWeek }, { data: recentResolved }] =
    await Promise.all([
      supabase
        .from("problem_tickets")
        .select("id, client_name, ticket_date, person, status, type, issue, updated_at")
        .eq("status", "in_progress")
        .order("ticket_date", { ascending: true })
        .limit(200),
      supabase
        .from("problem_tickets")
        .select("id", { count: "exact", head: true })
        .gte("ticket_date", lastMonday)
        .lt("ticket_date", thisMonday),
      // resolved_at is timestamptz; pull a superset and bucket by Toronto
      // calendar day in JS to avoid timezone-boundary SQL.
      supabase
        .from("problem_tickets")
        .select("id, resolved_at")
        .not("resolved_at", "is", null)
        .gte("resolved_at", new Date(Date.now() - 10 * 86400000).toISOString()),
    ]);
  if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

  const openTickets = (open ?? []) as ProblemTicket[];
  const resolvedLastWeek = (recentResolved ?? []).filter((t) => {
    const day = torontoDateString(new Date(t.resolved_at!));
    return day >= lastMonday && day < thisMonday;
  }).length;

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const staleIds = new Set(openTickets.filter((t) => t.updated_at < staleCutoff).map((t) => t.id));

  if (openTickets.length === 0 && (openedLastWeek ?? 0) === 0 && resolvedLastWeek === 0) {
    return NextResponse.json({ status: "skipped", reason: "no open tickets and no activity" });
  }

  const html = buildEmailHtml({
    open: openTickets,
    staleIds,
    openedLastWeek: openedLastWeek ?? 0,
    resolvedLastWeek,
    today,
  });

  const { problems_digest: recipients } = await getNotificationSettings();
  if (recipients.length === 0) {
    return NextResponse.json({ status: "skipped", reason: "no recipients configured" });
  }

  try {
    await getResend().emails.send({
      from: "RF Tools <noreply@rftransparent.ca>",
      to: recipients,
      subject: `Problem tickets: ${openTickets.length} open${staleIds.size > 0 ? ` (${staleIds.size} stale)` : ""} — weekly digest`,
      html,
    });
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await reportCronFailure("problems-digest", detail);
    return NextResponse.json({ error: "Digest send failed" }, { status: 500 });
  }

  return NextResponse.json({
    status: "sent",
    open: openTickets.length,
    stale: staleIds.size,
    openedLastWeek: openedLastWeek ?? 0,
    resolvedLastWeek,
  });
}

// Every run — scheduled or manual — is recorded for /settings/automations.
export const GET = withCronRun("problems-digest", handler);
