import { getSupabase } from "@/lib/supabase";
import twilio from "twilio";

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const { data: employees, error: empError } = await supabase
    .from("employees")
    .select("id, name, phone")
    .eq("active", true)
    .not("phone", "is", null);

  if (empError) throw new Error(empError.message);

  const { data: existing } = await supabase
    .from("employee_surveys")
    .select("employee_id")
    .eq("week_of", weekOf);

  const alreadySent = new Set((existing ?? []).map((r: { employee_id: string }) => r.employee_id));

  const twilioEnabled =
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM;

  const twilioClient = twilioEnabled
    ? twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
    : null;

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

    if (twilioClient) {
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_FROM!,
          to: `whatsapp:${emp.phone}`,
          body: `Hi ${emp.name} 👋 It's your weekly check-in! Please take 2 minutes: ${appUrl}/survey/${token}`,
        });
      } catch (err) {
        errors.push(`${emp.name} (WhatsApp send failed): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    sent++;
  }

  return { sent, skipped, errors };
}
