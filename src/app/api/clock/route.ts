import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";
import type { ClockErrorCode } from "@/lib/mobile-types";
import {
  checkGeofence,
  formatDistance,
  isValidLatitude,
  isValidLongitude,
  isStaleShift,
  startOfWeekInTimeZone,
  totalMinutes,
  validateClockPosition,
  validateSelfReportedClockOut,
  weekDays,
  type ClockEntry,
} from "@/lib/time-clock";

// Clock in/out for the signed-in employee. Everything is scoped to the
// employee row matching the login email — there is no way to read or write
// anyone else's time from this route. Manager tooling comes later and lives
// elsewhere.

interface LocationRow {
  name: string;
  latitude: number | null;
  longitude: number | null;
  clock_in_radius_m: number | null;
}

interface EmployeeRow {
  id: string;
  name: string;
  department: string;
  locations: LocationRow | null;
}

type GeofenceConfiguration =
  | { status: "none" }
  | { status: "invalid" }
  | {
      status: "ready";
      pin: { latitude: number; longitude: number; radiusM: number | null };
    };

function geofenceConfiguration(location: LocationRow | null): GeofenceConfiguration {
  if (!location) {
    return { status: "none" };
  }
  if (location.latitude == null && location.longitude == null) {
    return location.clock_in_radius_m == null ? { status: "none" } : { status: "invalid" };
  }
  const validRadius =
    location.clock_in_radius_m == null ||
    (Number.isInteger(location.clock_in_radius_m) &&
      location.clock_in_radius_m >= 25 &&
      location.clock_in_radius_m <= 5000);
  if (
    !isValidLatitude(location.latitude) ||
    !isValidLongitude(location.longitude) ||
    !validRadius
  ) {
    return { status: "invalid" };
  }
  return {
    status: "ready",
    pin: {
      latitude: location.latitude,
      longitude: location.longitude,
      radiusM: location.clock_in_radius_m,
    },
  };
}

function clockError(error: string, code: ClockErrorCode, status: number) {
  return NextResponse.json(
    { error, code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

function clockStatusResponse(status: unknown) {
  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function findEmployee(email: string): Promise<EmployeeRow | null> {
  const normalized = email.toLowerCase().trim();
  const { data, error } = await getSupabase()
    .from("employees")
    .select("id, name, department, locations(name, latitude, longitude, clock_in_radius_m)")
    .or(
      `email.eq.${quotePostgrestValue(normalized)},email_alt.eq.${quotePostgrestValue(normalized)}`,
    )
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Supabase types joined rows as an array even for a to-one relation.
  const row = data as unknown as {
    id: string;
    name: string;
    department: string;
    locations: LocationRow | LocationRow[] | null;
  } | null;
  if (!row) return null;
  const locations = Array.isArray(row.locations) ? row.locations[0] ?? null : row.locations;
  return { id: row.id, name: row.name, department: row.department, locations };
}

async function findOpenEntry(employeeId: string): Promise<ClockEntry | null> {
  const { data, error } = await getSupabase()
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at, flagged")
    .eq("employee_id", employeeId)
    .is("clock_out_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClockEntry | null) ?? null;
}

async function buildStatus(employee: EmployeeRow, now: Date) {
  const sb = getSupabase();
  const weekStart = startOfWeekInTimeZone(now);

  const [open, weekResult] = await Promise.all([
    findOpenEntry(employee.id),
    sb
      .from("time_entries")
      .select("id, clock_in_at, clock_out_at, flagged")
      .eq("employee_id", employee.id)
      .gte("clock_in_at", weekStart.toISOString())
      .order("clock_in_at", { ascending: true }),
  ]);
  if (weekResult.error) throw new Error(weekResult.error.message);

  const weekEntries = (weekResult.data ?? []) as ClockEntry[];
  // An open shift may have started before this week (a stale one from
  // Friday, say) — include it so its state is visible.
  if (open && !weekEntries.some((e) => e.id === open.id)) weekEntries.push(open);

  const geofence = geofenceConfiguration(employee.locations);
  return {
    linked: true,
    employeeName: employee.name,
    department: employee.department,
    locationName: employee.locations?.name ?? null,
    geofenced: geofence.status !== "none",
    geofenceReady: geofence.status !== "invalid",
    open: open
      ? { id: open.id, clockInAt: open.clock_in_at, stale: isStaleShift(open.clock_in_at, now) }
      : null,
    week: weekDays(weekEntries, now),
    weekMinutes: totalMinutes(
      weekEntries.filter((e) => Date.parse(e.clock_in_at) >= weekStart.getTime()),
      now,
    ),
  };
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.email) return clockError("Unauthorized", "unauthorized", 401);

  try {
    const employee = await findEmployee(user.email);
    if (!employee) {
      return NextResponse.json(
        { linked: false },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(await buildStatus(employee, new Date()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load clock status", error);
    return clockError("Clock status is temporarily unavailable.", "server_unavailable", 503);
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return clockError("Unauthorized", "unauthorized", 401);

  let body: {
    action?: string;
    clockOutAt?: string;
    position?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return clockError("Invalid request body", "invalid_request", 400);
  }

  try {
    const employee = await findEmployee(user.email);
    if (!employee) {
      return clockError(
        "Your login isn't linked to an employee profile. Ask your manager to add your email on the Employees page.",
        "profile_not_linked",
        403,
      );
    }

    const sb = getSupabase();
    const now = new Date();
    const open = await findOpenEntry(employee.id);

    if (body.action === "in") {
      if (open) {
        return clockError(
          isStaleShift(open.clock_in_at, now)
            ? "Your previous shift needs an end time before you can clock in again."
            : "You already have a running shift.",
          isStaleShift(open.clock_in_at, now) ? "stale_shift" : "duplicate_shift",
          409,
        );
      }
      const geofence = geofenceConfiguration(employee.locations);
      if (geofence.status === "invalid") {
        return clockError(
          "Your store's clock-in location is not configured correctly. Ask a manager for help.",
          "geofence_unavailable",
          503,
        );
      }
      let clockInDistanceM: number | null = null;
      let clockInAccuracyM: number | null = null;
      let clockInCapturedAt: string | null = null;
      if (geofence.status === "ready") {
        if (body.position == null) {
          return clockError(
            `Clocking in at ${employee.locations?.name ?? "your store"} needs your location. Allow location access and try again.`,
            "permission_required",
            400,
          );
        }
        const position = validateClockPosition(body.position, now);
        if (!position.ok) {
          if (position.code === "inaccurate_location") {
            return clockError(
              "Your location is not accurate enough to clock in. Move near a window or outdoors and try again.",
              "inaccurate_location",
              422,
            );
          }
          if (position.code === "stale_location") {
            return clockError(
              "That location reading is out of date. Get a fresh location and try again.",
              "stale_location",
              422,
            );
          }
          return clockError("The location reading was invalid. Try again.", "invalid_location", 400);
        }
        const check = checkGeofence(position.position, geofence.pin);
        if (!check.ok) {
          return clockError(
            `You look ${formatDistance(check.distanceM)} from ${employee.locations?.name ?? "your store"}. Clock in when you arrive.`,
            "outside_geofence",
            403,
          );
        }
        clockInDistanceM = check.distanceM;
        clockInAccuracyM = Math.round(position.position.accuracy);
        clockInCapturedAt = position.capturedAt.toISOString();
      }

      const { error } = await sb.from("time_entries").insert({
        employee_id: employee.id,
        location_name: employee.locations?.name ?? null,
        clock_in_at: now.toISOString(),
        clock_in_distance_m: clockInDistanceM,
        clock_in_accuracy_m: clockInAccuracyM,
        clock_in_position_captured_at: clockInCapturedAt,
      });
      if (error?.code === "23505") {
        return clockError("You already have a running shift.", "duplicate_shift", 409);
      }
      if (error) throw new Error(error.message);
      return clockStatusResponse(await buildStatus(employee, now));
    }

    if (body.action === "out") {
      if (!open) {
        return clockError("You're not clocked in.", "no_open_shift", 409);
      }
      if (isStaleShift(open.clock_in_at, now)) {
        return clockError(
          "This shift ran too long. Confirm when it really ended.",
          "stale_shift",
          409,
        );
      }
      const result = await sb
        .from("time_entries")
        .update({ clock_out_at: now.toISOString() })
        .eq("id", open.id)
        .is("clock_out_at", null)
        .select("id")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) return clockError("You're not clocked in.", "no_open_shift", 409);
      return clockStatusResponse(await buildStatus(employee, now));
    }

    if (body.action === "resolve") {
      if (!open) {
        return clockError("There's no shift to fix.", "no_open_shift", 409);
      }
      const clockOutAt = body.clockOutAt ?? "";
      const invalid = validateSelfReportedClockOut(open.clock_in_at, clockOutAt, now);
      if (invalid) return clockError(invalid, "invalid_end_time", 400);
      const result = await sb
        .from("time_entries")
        .update({
          clock_out_at: new Date(clockOutAt).toISOString(),
          flagged: true,
          flag_reason: "Self-reported end time after a forgotten clock-out",
        })
        .eq("id", open.id)
        .is("clock_out_at", null)
        .select("id")
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) return clockError("There's no shift to fix.", "no_open_shift", 409);
      return clockStatusResponse(await buildStatus(employee, now));
    }

    return clockError("Unknown action", "invalid_request", 400);
  } catch (error) {
    console.error("Clock action failed", error);
    return clockError("Clocking is temporarily unavailable. Try again.", "server_unavailable", 503);
  }
}
