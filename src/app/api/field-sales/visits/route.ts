import { NextRequest, NextResponse } from "next/server";
import {
  classifyVisitLocation,
  parseFreshVisitPosition,
  visitFinishInputSchema,
  visitStartInputSchema,
} from "@/lib/field-sales";
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
  const parsed = visitStartInputSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid check-in." }, 400);
  const position = parseFreshVisitPosition(parsed.data.position);
  if (!position.ok) {
    const message = position.code === "inaccurate_location"
      ? "Your location is not accurate enough. Move near a window or outdoors and try again."
      : position.code === "stale_location"
        ? "That location reading is out of date. Get a fresh location and try again."
        : "The location reading was invalid. Try again.";
    return json({ error: message, code: position.code }, 422);
  }

  try {
    const supabase = getSupabase();
    const [accountResult, openResult] = await Promise.all([
      supabase
        .from("field_sales_accounts")
        .select("id, latitude, longitude, verification_radius_m")
        .eq("id", parsed.data.accountId)
        .maybeSingle(),
      supabase
        .from("field_sales_visits")
        .select("id")
        .eq("employee_id", employeeId)
        .eq("status", "open")
        .maybeSingle(),
    ]);
    if (accountResult.error) throw new Error(accountResult.error.message);
    if (openResult.error) throw new Error(openResult.error.message);
    if (!accountResult.data) return json({ error: "Customer site not found." }, 404);
    if (openResult.data) return json({ error: "Finish your active visit before checking in again." }, 409);

    if (parsed.data.appointmentId) {
      const appointment = await supabase
        .from("field_sales_appointments")
        .select("id")
        .eq("id", parsed.data.appointmentId)
        .eq("employee_id", employeeId)
        .eq("account_id", parsed.data.accountId)
        .maybeSingle();
      if (appointment.error) throw new Error(appointment.error.message);
      if (!appointment.data) return json({ error: "Appointment not found." }, 404);
    }

    const classification = classifyVisitLocation(
      position.position,
      {
        latitude: accountResult.data.latitude,
        longitude: accountResult.data.longitude,
        verificationRadiusM: accountResult.data.verification_radius_m,
      },
      parsed.data.establishSitePin,
    );

    if (classification.verification === "pin_created") {
      const pinResult = await supabase
        .from("field_sales_accounts")
        .update({
          latitude: position.position.latitude,
          longitude: position.position.longitude,
          pin_accuracy_m: Math.round(position.position.accuracy),
          pin_captured_at: position.capturedAt.toISOString(),
          pin_created_by_employee_id: employeeId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", parsed.data.accountId)
        .is("latitude", null)
        .is("longitude", null);
      if (pinResult.error) throw new Error(pinResult.error.message);
    }

    const result = await supabase
      .from("field_sales_visits")
      .insert({
        employee_id: employeeId,
        account_id: parsed.data.accountId,
        appointment_id: parsed.data.appointmentId || null,
        check_in_latitude: position.position.latitude,
        check_in_longitude: position.position.longitude,
        check_in_accuracy_m: Math.round(position.position.accuracy),
        check_in_position_captured_at: position.capturedAt.toISOString(),
        location_verification: classification.verification,
        distance_from_site_m: classification.distanceM,
        odometer_start_km: parsed.data.odometerStartKm ?? null,
      })
      .select("id")
      .single();
    if (result.error?.code === "23505") {
      return json({ error: "You already have an active visit." }, 409);
    }
    if (result.error) throw new Error(result.error.message);

    if (parsed.data.appointmentId) {
      await supabase
        .from("field_sales_appointments")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", parsed.data.appointmentId)
        .eq("employee_id", employeeId);
    }

    return json({
      ok: true,
      visitId: result.data.id,
      locationVerification: classification.verification,
      distanceFromSiteM: classification.distanceM,
    }, 201);
  } catch (error) {
    console.error("Failed to start field sales visit", error);
    return json({ error: "The visit could not be started." }, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const access = await personalActor();
  if ("error" in access) return access.error;
  const employeeId = access.actor.employee!.id;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const parsed = visitFinishInputSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid visit update." }, 400);

  try {
    const supabase = getSupabase();
    const visit = await supabase
      .from("field_sales_visits")
      .select("id, appointment_id, odometer_start_km")
      .eq("id", parsed.data.visitId)
      .eq("employee_id", employeeId)
      .eq("status", "open")
      .maybeSingle();
    if (visit.error) throw new Error(visit.error.message);
    if (!visit.data) return json({ error: "Active visit not found." }, 404);
    if (
      parsed.data.odometerEndKm != null &&
      visit.data.odometer_start_km != null &&
      parsed.data.odometerEndKm < Number(visit.data.odometer_start_km)
    ) {
      return json({ error: "Ending odometer must be greater than or equal to the starting odometer." }, 400);
    }

    const result = await supabase.rpc("complete_field_sales_visit", {
      p_visit_id: parsed.data.visitId,
      p_employee_id: employeeId,
      p_checked_out_at: new Date().toISOString(),
      p_odometer_end_km: parsed.data.odometerEndKm ?? null,
      p_outcome: parsed.data.outcome,
      p_notes: parsed.data.notes ?? "",
      p_next_action_type: parsed.data.nextActionType,
      p_next_action_due_at: parsed.data.nextActionType === "no_further_action"
        ? null
        : parsed.data.nextActionDueAt,
      p_next_action_notes: parsed.data.nextActionNotes ?? "",
    });
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return json({ error: "Active visit not found." }, 409);
    return json({ ok: true });
  } catch (error) {
    console.error("Failed to finish field sales visit", error);
    return json({ error: "The visit could not be completed." }, 503);
  }
}
