import { getSupabase } from "@/lib/supabase";
import {
  sendWhatsAppBirthdayGreeting,
  sendWhatsAppBirthdayReminder,
} from "@/lib/whatsapp";

const TORONTO_TIME_ZONE = "America/Toronto";

export interface BirthdayEmployee {
  id: string;
  name: string;
  phone: string | null;
  birthday: string | null;
}

export interface BirthdayMessagePlanItem {
  kind: "greeting" | "coworker_reminder";
  birthdayEmployee: BirthdayEmployee;
  recipient: BirthdayEmployee;
}

interface BirthdayDeliveryRow {
  id: string;
  status: "pending" | "sent" | "delivered" | "failed";
}

export interface BirthdayAutomationResult {
  status: "success" | "skipped";
  celebrationDate: string;
  birthdayEmployees: number;
  greetingsSent: number;
  remindersSent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

function torontoParts(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TORONTO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
  };
}

export function torontoBirthdayDateKey(date = new Date()): string {
  const parts = torontoParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isBirthdayDispatchHour(date = new Date()): boolean {
  return torontoParts(date).hour === 9;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function birthdayMatchesDate(birthday: string | null, dateKey: string): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday) || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }
  const birthdayMonthDay = birthday.slice(5);
  const dateMonthDay = dateKey.slice(5);
  if (birthdayMonthDay === dateMonthDay) return true;
  const year = Number(dateKey.slice(0, 4));
  return birthdayMonthDay === "02-29" && dateMonthDay === "02-28" && !isLeapYear(year);
}

export function createBirthdayMessagePlan(
  employees: BirthdayEmployee[],
  celebrationDate: string,
): BirthdayMessagePlanItem[] {
  const birthdayEmployees = employees.filter((employee) => birthdayMatchesDate(employee.birthday, celebrationDate));
  return birthdayEmployees.flatMap((birthdayEmployee) => [
    { kind: "greeting" as const, birthdayEmployee, recipient: birthdayEmployee },
    ...employees
      .filter((employee) => employee.id !== birthdayEmployee.id)
      .map((recipient) => ({ kind: "coworker_reminder" as const, birthdayEmployee, recipient })),
  ]);
}

async function loadActiveEmployees(): Promise<BirthdayEmployee[]> {
  const { data, error } = await getSupabase()
    .from("employees")
    .select("id,name,phone,birthday")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as BirthdayEmployee[];
}

async function ensureDelivery(
  item: BirthdayMessagePlanItem,
  celebrationDate: string,
): Promise<BirthdayDeliveryRow> {
  const supabase = getSupabase();
  const identity = {
    celebration_date: celebrationDate,
    birthday_employee_id: item.birthdayEmployee.id,
    recipient_employee_id: item.recipient.id,
    kind: item.kind,
  };
  const { error: insertError } = await supabase
    .from("birthday_message_deliveries")
    .upsert({
      ...identity,
      birthday_employee_name: item.birthdayEmployee.name,
      recipient_name: item.recipient.name,
    }, {
      onConflict: "celebration_date,birthday_employee_id,recipient_employee_id,kind",
      ignoreDuplicates: true,
    });
  if (insertError) throw new Error(insertError.message);

  const query = supabase
    .from("birthday_message_deliveries")
    .select("id,status")
    .eq("celebration_date", celebrationDate)
    .eq("birthday_employee_id", item.birthdayEmployee.id)
    .eq("recipient_employee_id", item.recipient.id)
    .eq("kind", item.kind);
  const { data, error } = await query.single();
  if (error || !data) throw new Error(error?.message ?? "Birthday delivery record was not created");
  return data as BirthdayDeliveryRow;
}

async function markDelivery(
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("birthday_message_deliveries")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function deliverBirthdayMessage(
  item: BirthdayMessagePlanItem,
  celebrationDate: string,
): Promise<"sent" | "skipped"> {
  const delivery = await ensureDelivery(item, celebrationDate);
  if (delivery.status === "sent" || delivery.status === "delivered") return "skipped";
  if (!item.recipient.phone) {
    const detail = `${item.recipient.name} does not have a phone number`;
    await markDelivery(delivery.id, { status: "failed", delivery_error: detail });
    throw new Error(detail);
  }

  try {
    const result = item.kind === "greeting"
      ? await sendWhatsAppBirthdayGreeting({
        to: item.recipient.phone,
        employeeName: item.birthdayEmployee.name,
      })
      : await sendWhatsAppBirthdayReminder({
        to: item.recipient.phone,
        recipientName: item.recipient.name,
        birthdayEmployeeName: item.birthdayEmployee.name,
      });
    const sentAt = new Date().toISOString();
    await markDelivery(delivery.id, {
      status: "sent",
      provider_message_id: result.messageId,
      delivery_error: null,
      sent_at: sentAt,
    });
    return "sent";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await markDelivery(delivery.id, { status: "failed", delivery_error: detail });
    throw error;
  }
}

export async function runBirthdayAutomation(now = new Date()): Promise<BirthdayAutomationResult> {
  const celebrationDate = torontoBirthdayDateKey(now);
  const employees = await loadActiveEmployees();
  const plan = createBirthdayMessagePlan(employees, celebrationDate);
  const birthdayEmployees = new Set(plan.map((item) => item.birthdayEmployee.id)).size;
  if (plan.length === 0) {
    return {
      status: "skipped",
      celebrationDate,
      birthdayEmployees: 0,
      greetingsSent: 0,
      remindersSent: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }

  let greetingsSent = 0;
  let remindersSent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of plan) {
    try {
      const result = await deliverBirthdayMessage(item, celebrationDate);
      if (result === "skipped") skipped += 1;
      else if (item.kind === "greeting") greetingsSent += 1;
      else remindersSent += 1;
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${item.kind} for ${item.birthdayEmployee.name} to ${item.recipient.name}: ${detail}`);
    }
  }

  return {
    status: "success",
    celebrationDate,
    birthdayEmployees,
    greetingsSent,
    remindersSent,
    skipped,
    failed,
    errors,
  };
}
