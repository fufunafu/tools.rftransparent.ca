import { NextRequest, NextResponse } from "next/server";
import { appointmentInputSchema } from "@/lib/field-sales";
import { getFieldSalesActor } from "@/lib/field-sales-access";
import { getSupabase } from "@/lib/supabase";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function personalActor() {
  const actor = await getFieldSalesActor();
  if (!actor) return { error: json({ error: "Unauthorized" }, 401) } as const;
  if (!actor.employee || !actor.canUsePersonalWorkspace) {
    return { error: json({ error: "An active sales profile is required." }, 403) } as const;
  }
  return { actor } as const;
}

export async function POST(request: NextRequest) {
  const access = await personalActor();
  if ("error" in access) return access.error;
  const employeeId = access.actor.employee!.id;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const parsed = appointmentInputSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid appointment." }, 400);

  try {
    const supabase = getSupabase();
    let accountId = parsed.data.accountId ?? null;
    if (accountId) {
      const account = await supabase
        .from("field_sales_accounts")
        .select("id")
        .eq("id", accountId)
        .maybeSingle();
      if (account.error) throw new Error(account.error.message);
      if (!account.data) return json({ error: "Customer site not found." }, 404);
    } else {
      const created = await supabase
        .from("field_sales_accounts")
        .insert({
          name: parsed.data.accountName,
          address: parsed.data.address,
          assigned_employee_id: employeeId,
          created_by_employee_id: employeeId,
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);
      accountId = created.data.id;
    }

    const result = await supabase
      .from("field_sales_appointments")
      .insert({
        employee_id: employeeId,
        account_id: accountId,
        title: parsed.data.title,
        starts_at: parsed.data.startsAt,
        ends_at: parsed.data.endsAt || null,
        notes: parsed.data.notes || null,
        created_by_email: access.actor.email,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return json({ ok: true, appointmentId: result.data.id }, 201);
  } catch (error) {
    console.error("Failed to create field sales appointment", error);
    return json({ error: "The appointment could not be saved." }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await getFieldSalesActor();
  if (!actor) return json({ error: "Unauthorized" }, 401);

  let body: { appointmentId?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (!body.appointmentId || !["scheduled", "cancelled"].includes(body.status ?? "")) {
    return json({ error: "Appointment and valid status are required." }, 400);
  }

  try {
    const supabase = getSupabase();
    const appointment = await supabase
      .from("field_sales_appointments")
      .select("id, employee_id")
      .eq("id", body.appointmentId)
      .maybeSingle();
    if (appointment.error) throw new Error(appointment.error.message);
    if (!appointment.data) return json({ error: "Appointment not found." }, 404);
    if (!actor.canManage && appointment.data.employee_id !== actor.employee?.id) {
      return json({ error: "Forbidden" }, 403);
    }
    const result = await supabase
      .from("field_sales_appointments")
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq("id", body.appointmentId)
      .select("id")
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return json({ ok: true });
  } catch (error) {
    console.error("Failed to update field sales appointment", error);
    return json({ error: "The appointment could not be updated." }, 503);
  }
}
