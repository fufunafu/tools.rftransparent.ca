import "server-only";
import { getSupabase } from "@/lib/supabase";
import { getResend } from "@/lib/resend";
import { OWNER_EMAIL } from "@/lib/authz";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import { normalizeEmail } from "./identity.mjs";

export interface CrmReminder {
  id: string; record_id: string; due_at: string; owner_email: string;
  kind: "upcoming" | "overdue"; title: string; attempts: number;
}

export function reminderMessage(reminder: CrmReminder) {
  const when = new Date(reminder.due_at).toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
  const label = reminder.kind === "overdue" ? "Task overdue" : "Task due soon";
  return {
    from: "RF Transparent <info@glass-railing.com>",
    to: [reminder.owner_email],
    subject: `${label}: ${reminder.title.replace(/[\r\n]/g, " ").slice(0, 180)}`,
    text: `${label}\n\n${reminder.title}\nDue: ${when} (Toronto time)\n\nOpen the task:\nhttps://tools.rftransparent.ca/hubspot-dupe?record=${encodeURIComponent(reminder.record_id)}\n\nYou can turn off reminders in the task's settings.`,
  };
}

export async function sendCrmReminders() {
  if (!process.env.RESEND_API_KEY) return { sent: 0, skipped: "Email delivery is not configured." };
  const db = getSupabase();
  const token = crypto.randomUUID();
  const claimed = await db.rpc("crm_claim_reminders", { p_token: token, p_limit: 20 });
  if (claimed.error) throw new Error("Task reminder queue unavailable");
  let sent = 0;
  let failed = 0;
  for (const row of (claimed.data ?? []) as CrmReminder[]) {
    let status: "sent" | "pending" | "cancelled" | "failed" = "pending";
    let errorCode: string | null = null;
    let providerId: string | null = null;
    try {
      const email = normalizeEmail(row.owner_email);
      const employee = email && email !== OWNER_EMAIL ? await findActiveEmployeeByEmail(email) : null;
      const eligible = email === OWNER_EMAIL || (employee && ["management", "sales", "customer_service"].includes(employee.department));
      if (!email || !eligible) { status = "cancelled"; errorCode = "owner_unavailable"; }
      else {
        // Recheck immediately before delivery, including completion, rescheduling,
        // reassignment and opt-out after the batch was claimed.
        const current = await db.from("crm_records").select("id").eq("id", row.record_id)
          .eq("archived", false).eq("effective_task_status", "open").eq("reminder_enabled", true)
          .eq("owner_email", row.owner_email).eq("effective_due_at", row.due_at).maybeSingle();
        if (current.error) throw new Error("Task unavailable");
        if (!current.data || (row.kind === "upcoming" && Date.parse(row.due_at) <= Date.now())) {
          status = "cancelled"; errorCode = "task_changed";
        } else {
          const result = await getResend().emails.send(reminderMessage(row), { idempotencyKey: `crm-reminder/${row.id}` });
          if (result.error || !result.data?.id) throw new Error("Delivery unavailable");
          status = "sent"; providerId = result.data.id; sent += 1;
        }
      }
    } catch { errorCode = "delivery_unconfirmed"; failed += 1; if (row.attempts >= 10) status = "failed"; }
    const saved = await db.rpc("crm_finish_reminder", { p_id: row.id, p_token: token, p_status: status, p_error: errorCode, p_provider_id: providerId });
    if (saved.error) throw new Error("Reminder receipt could not be saved");
  }
  return { sent, failed };
}
