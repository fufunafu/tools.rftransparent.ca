import { getSupabase } from "@/lib/supabase";
import { assertWhatsAppConfigured, sendWhatsAppSurvey } from "@/lib/whatsapp";

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split("T")[0];
}

export async function sendSurveys(): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const supabase = getSupabase();
  const weekOf = getMondayOfWeek(new Date());
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const testRecipient = process.env.WHATSAPP_TEST_RECIPIENT?.trim() || null;
  const testEmployeeId = process.env.WHATSAPP_TEST_EMPLOYEE_ID?.trim() || null;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  if (Boolean(testRecipient) !== Boolean(testEmployeeId)) {
    throw new Error("WHATSAPP_TEST_RECIPIENT and WHATSAPP_TEST_EMPLOYEE_ID must be configured together");
  }
  assertWhatsAppConfigured();

  let employeeQuery = supabase
    .from("employees")
    .select("id, name, phone")
    .eq("active", true);
  employeeQuery = testEmployeeId
    ? employeeQuery.eq("id", testEmployeeId)
    : employeeQuery.not("phone", "is", null);

  const { data: employees, error: empError } = await employeeQuery;

  if (empError) throw new Error(empError.message);

  const { data: existing } = await supabase
    .from("employee_surveys")
    .select("employee_id")
    .eq("week_of", weekOf);

  const alreadySent = new Set((existing ?? []).map((r: { employee_id: string }) => r.employee_id));

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const emp of employees ?? []) {
    if (alreadySent.has(emp.id)) {
      skipped++;
      continue;
    }

    const token = crypto.randomUUID();

    const { error: insertError } = await supabase.from("employee_surveys").insert({
      employee_id: emp.id,
      token,
      week_of: weekOf,
    });

    if (insertError) {
      errors.push(`${emp.name}: ${insertError.message}`);
      continue;
    }

    try {
      await sendWhatsAppSurvey({
        to: testRecipient ?? emp.phone,
        employeeName: emp.name,
        surveyUrl: `${appUrl}/survey/${token}`,
      });
    } catch (err) {
      const { error: rollbackError } = await supabase
        .from("employee_surveys")
        .delete()
        .eq("token", token);
      const sendError = err instanceof Error ? err.message : String(err);
      const rollbackDetail = rollbackError ? `; cleanup failed: ${rollbackError.message}` : "";
      errors.push(`${emp.name} (WhatsApp send failed): ${sendError}${rollbackDetail}`);
      continue;
    }

    sent++;
  }

  return { sent, skipped, errors };
}
