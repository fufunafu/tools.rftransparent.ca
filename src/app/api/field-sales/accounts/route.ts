import { NextRequest, NextResponse } from "next/server";
import { fieldSalesAccountInputSchema } from "@/lib/field-sales";
import { getFieldSalesActor } from "@/lib/field-sales-access";
import { getSupabase } from "@/lib/supabase";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function PATCH(request: NextRequest) {
  const actor = await getFieldSalesActor();
  if (!actor) return json({ error: "Unauthorized" }, 401);
  if (!actor.canManage) return json({ error: "Forbidden" }, 403);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const parsed = fieldSalesAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid customer account." }, 400);
  }

  const supabase = getSupabase();
  if (parsed.data.assignedEmployeeId) {
    const employee = await supabase
      .from("employees")
      .select("id")
      .eq("id", parsed.data.assignedEmployeeId)
      .eq("active", true)
      .maybeSingle();
    if (employee.error) return json({ error: "The assigned representative could not be verified." }, 503);
    if (!employee.data) return json({ error: "The assigned representative was not found." }, 404);
  }

  const result = await supabase
    .from("field_sales_accounts")
    .update({
      assigned_employee_id: parsed.data.assignedEmployeeId || null,
      territory: parsed.data.territory || null,
      account_type: parsed.data.accountType,
      distributor_group: parsed.data.distributorGroup || null,
      lifecycle_status: parsed.data.lifecycleStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.accountId)
    .select("id")
    .maybeSingle();
  if (result.error) {
    console.error("Failed to update field sales account", result.error);
    return json({ error: "The customer account could not be updated." }, 503);
  }
  if (!result.data) return json({ error: "Customer account not found." }, 404);
  return json({ ok: true });
}
