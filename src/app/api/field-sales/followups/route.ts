import { NextRequest, NextResponse } from "next/server";
import { fieldSalesFollowupUpdateSchema } from "@/lib/field-sales";
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

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const parsed = fieldSalesFollowupUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid follow-up update." }, 400);
  }

  const supabase = getSupabase();
  const existing = await supabase
    .from("field_sales_followups")
    .select("id, employee_id, status")
    .eq("id", parsed.data.followupId)
    .maybeSingle();
  if (existing.error) return json({ error: "The follow-up could not be loaded." }, 503);
  if (!existing.data) return json({ error: "Follow-up not found." }, 404);
  if (!actor.canManage && existing.data.employee_id !== actor.employee?.id) {
    return json({ error: "Forbidden" }, 403);
  }
  if (existing.data.status !== "open") {
    return json({ error: "This follow-up is already closed." }, 409);
  }

  const now = new Date().toISOString();
  const result = await supabase
    .from("field_sales_followups")
    .update({
      status: parsed.data.status,
      completed_at: parsed.data.status === "completed" ? now : null,
      updated_at: now,
    })
    .eq("id", parsed.data.followupId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (result.error) {
    console.error("Failed to update field sales follow-up", result.error);
    return json({ error: "The follow-up could not be updated." }, 503);
  }
  if (!result.data) return json({ error: "This follow-up is already closed." }, 409);
  return json({ ok: true });
}
