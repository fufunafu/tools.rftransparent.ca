import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getResend } from "@/lib/resend";
import { getStores } from "@/lib/shopify";
import { FOLLOWUP_CATEGORIES, type FollowUpLead, type LeadStatus } from "@/lib/followup";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { startOfDayInTimeZone } from "@/lib/dates";
import { formatCADWhole } from "@/lib/format";
import { alertOnSoftFailures } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Map Shopify store IDs to notification email addresses
const STORE_EMAILS: Record<string, string> = {
  store1: "info@glass-railing.com",
  store2: "info@glassrailingstore.com",
  store3: "anne@cloture-verre.com",
};

function buildEmailHtml(storeName: string, dueToday: FollowUpLead[], overdue: FollowUpLead[]): string {
  const rows = [...overdue, ...dueToday].slice(0, 20);

  const tableRows = rows.map((l) => {
    const isOverdue = overdue.includes(l);
    const statusLabel = FOLLOWUP_CATEGORIES[l.lead_status as LeadStatus]?.label ?? l.lead_status;
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px;font-weight:500">${l.draft_name}</td>
      <td style="padding:8px">${l.customer_name || "Unknown"}</td>
      <td style="padding:8px;text-align:right">${formatCADWhole(Number(l.quote_amount))}</td>
      <td style="padding:8px">${statusLabel}</td>
      <td style="padding:8px;color:${isOverdue ? "#dc2626" : "#d97706"};font-weight:500">${isOverdue ? "Overdue" : "Due Today"}</td>
    </tr>`;
  }).join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e293b;margin-bottom:4px">Follow-up Reminder — ${storeName}</h2>
      <p style="color:#64748b;margin-top:0">
        ${overdue.length > 0 ? `<span style="color:#dc2626;font-weight:600">${overdue.length} overdue</span> · ` : ""}
        ${dueToday.length} due today
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Draft</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Customer</th>
            <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;color:#94a3b8">Amount</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Status</th>
            <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#94a3b8">Due</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${rows.length < overdue.length + dueToday.length ? `<p style="color:#94a3b8;font-size:12px;margin-top:8px">Showing top 20 of ${overdue.length + dueToday.length} leads</p>` : ""}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">
        View all follow-ups at <a href="https://tools.rftransparent.ca/customer-service/follow-up" style="color:#3b82f6">tools.rftransparent.ca</a>
      </p>
    </div>
  `;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const resend = getResend();
  const stores = getStores();
  const results: { store: string; status: string; due?: number; overdue?: number; error?: string }[] = [];

  const now = new Date();
  const todayStart = startOfDayInTimeZone(now).toISOString();
  const tomorrowStart = startOfDayInTimeZone(now, undefined, 1).toISOString();

  for (const store of stores) {
    const email = STORE_EMAILS[store.id];
    if (!email) {
      results.push({ store: store.id, status: "skipped", error: "No email configured" });
      continue;
    }

    try {
      // Fetch due today
      const { data: dueToday } = await supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", store.id)
        .is("closed_at", null)
        .gte("next_followup_at", todayStart)
        .lt("next_followup_at", tomorrowStart)
        .order("quote_amount", { ascending: false });

      // Fetch overdue
      const { data: overdue } = await supabase
        .from("followup_leads")
        .select("*")
        .eq("store_id", store.id)
        .is("closed_at", null)
        .lt("next_followup_at", todayStart)
        .not("next_followup_at", "is", null)
        .order("quote_amount", { ascending: false });

      const dueTodayList = (dueToday ?? []) as FollowUpLead[];
      const overdueList = (overdue ?? []) as FollowUpLead[];

      if (dueTodayList.length === 0 && overdueList.length === 0) {
        results.push({ store: store.id, status: "skipped", due: 0, overdue: 0 });
        continue;
      }

      const html = buildEmailHtml(store.label, dueTodayList, overdueList);

      await resend.emails.send({
        from: "RF Tools <noreply@rftransparent.ca>",
        to: email,
        subject: `Follow-up: ${overdueList.length > 0 ? `${overdueList.length} overdue, ` : ""}${dueTodayList.length} due today — ${store.label}`,
        html,
      });

      results.push({ store: store.id, status: "sent", due: dueTodayList.length, overdue: overdueList.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[followup-reminders] ${store.id}:`, err);
      results.push({ store: store.id, status: "error", error: msg });
    }
  }

  await alertOnSoftFailures("followup-reminders", results);
  return NextResponse.json({ results });
}
