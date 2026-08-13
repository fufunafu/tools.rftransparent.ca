import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser, isRestrictedSurveyManager } from "@/lib/admin-auth";
import { normalizeOptionalInternationalPhone } from "@/lib/phone";
import { getSupabase } from "@/lib/supabase";
import { sendWhatsAppEmployeeUpdate } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const ACTION_STATUSES = new Set(["open", "acknowledged", "in_progress", "completed", "cancelled"]);

function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function canAccessCampaign(campaignId: string | null): Promise<boolean> {
  if (!campaignId) return true;
  const { data, error } = await getSupabase()
    .from("survey_campaigns")
    .select("privacy_model")
    .eq("id", campaignId)
    .single();
  if (error || !data) return false;
  return data.privacy_model !== "restricted_named" || await isRestrictedSurveyManager();
}

export async function POST(request: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const kind = body.kind;
  if (kind !== "team_action" && kind !== "employee_update") {
    return NextResponse.json({ error: "Action kind must be team_action or employee_update" }, { status: 400 });
  }
  const title = trimmed(body.title);
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  const ownerName = trimmed(body.owner_name);
  const dueAt = trimmed(body.due_at);
  if (kind === "team_action" && (!ownerName || !dueAt)) {
    return NextResponse.json({ error: "Team-wide actions require an owner and due date" }, { status: 400 });
  }
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
    return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
  }
  const campaignId = trimmed(body.campaign_id);
  if (!(await canAccessCampaign(campaignId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  const { data, error } = await getSupabase()
    .from("survey_actions")
    .insert({
      campaign_id: campaignId,
      kind,
      title,
      issue: trimmed(body.issue),
      owner_employee_id: trimmed(body.owner_employee_id),
      owner_name: ownerName,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      resolution: trimmed(body.resolution),
      private: kind !== "employee_update",
      created_by: user?.email ?? "management",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ action: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = trimmed(body?.id);
  if (!body || !id) return NextResponse.json({ error: "Action id is required" }, { status: 400 });

  const status = trimmed(body.status);
  if (status && !ACTION_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid action status" }, { status: 400 });
  }
  const { data: existing, error: existingError } = await getSupabase()
    .from("survey_actions")
    .select("id,acknowledged_at,campaign_id")
    .eq("id", id)
    .single();
  if (existingError || !existing) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }
  if (!(await canAccessCampaign(existing.campaign_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const now = new Date().toISOString();
  const changes: Record<string, unknown> = { updated_at: now };
  for (const key of ["title", "issue", "owner_employee_id", "owner_name", "resolution"] as const) {
    if (key in body) changes[key] = trimmed(body[key]);
  }
  if ("due_at" in body) {
    const dueAt = trimmed(body.due_at);
    if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    }
    changes.due_at = dueAt ? new Date(dueAt).toISOString() : null;
  }
  if (status) {
    changes.status = status;
    if (status === "acknowledged") changes.acknowledged_at = now;
    if (status === "completed") {
      changes.completed_at = now;
      if (!existing.acknowledged_at) changes.acknowledged_at = now;
    }
  }
  const { data, error } = await getSupabase()
    .from("survey_actions")
    .update(changes)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ action: data });
}

export async function PUT(request: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = trimmed(body?.id);
  if (!id) return NextResponse.json({ error: "Action id is required" }, { status: 400 });

  const { data: action, error: actionError } = await getSupabase()
    .from("survey_actions")
    .select("id,kind,title,resolution,published_at,campaign_id")
    .eq("id", id)
    .single();
  if (actionError || !action) return NextResponse.json({ error: "Action not found" }, { status: 404 });
  if (!(await canAccessCampaign(action.campaign_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (action.kind !== "employee_update") {
    return NextResponse.json({ error: "Only employee updates can be published" }, { status: 400 });
  }
  if (action.published_at) return NextResponse.json({ error: "Update already published" }, { status: 409 });
  if (!action.resolution?.trim()) {
    return NextResponse.json({ error: "Add the 'we did' update before publishing" }, { status: 400 });
  }

  const { data: employees, error: employeeError } = await getSupabase()
    .from("employees")
    .select("id,name,phone")
    .eq("active", true)
    .not("phone", "is", null);
  if (employeeError) return NextResponse.json({ error: employeeError.message }, { status: 500 });

  const errors: string[] = [];
  let sent = 0;
  const { data: priorDeliveries, error: deliveryLookupError } = await getSupabase()
    .from("survey_action_deliveries")
    .select("employee_id,status")
    .eq("action_id", id);
  if (deliveryLookupError) return NextResponse.json({ error: deliveryLookupError.message }, { status: 500 });
  const alreadySent = new Set(
    (priorDeliveries ?? [])
      .filter((delivery) => delivery.status === "sent" || delivery.status === "delivered")
      .map((delivery) => delivery.employee_id),
  );
  for (const employee of employees ?? []) {
    if (alreadySent.has(employee.id)) continue;
    try {
      const phone = normalizeOptionalInternationalPhone(employee.phone);
      if (!phone) throw new Error("No phone number");
      const result = await sendWhatsAppEmployeeUpdate({
        to: phone,
        employeeName: employee.name,
        title: action.title,
        update: action.resolution,
      });
      const timestamp = new Date().toISOString();
      const { error: deliveryError } = await getSupabase()
        .from("survey_action_deliveries")
        .upsert({
          action_id: id,
          employee_id: employee.id,
          employee_name: employee.name,
          provider_message_id: result.messageId,
          status: "sent",
          delivery_error: null,
          sent_at: timestamp,
          updated_at: timestamp,
        }, { onConflict: "action_id,employee_id" });
      if (deliveryError) throw new Error(deliveryError.message);
      sent += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await getSupabase()
        .from("survey_action_deliveries")
        .upsert({
          action_id: id,
          employee_id: employee.id,
          employee_name: employee.name,
          status: "failed",
          delivery_error: detail,
          updated_at: new Date().toISOString(),
        }, { onConflict: "action_id,employee_id" });
      errors.push(`${employee.name}: ${detail}`);
    }
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: "Some employee updates failed", sent, errors }, { status: 502 });
  }
  const now = new Date().toISOString();
  const totalSent = alreadySent.size + sent;
  const { error: updateError } = await getSupabase()
    .from("survey_actions")
    .update({ published_at: now, recipient_count: totalSent, status: "completed", completed_at: now, updated_at: now })
    .eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ published: true, sent: totalSent });
}
