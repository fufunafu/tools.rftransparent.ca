import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { quotePostgrestValue } from "@/lib/postgrest";
import {
  checkGeofence,
  formatDistance,
  isStaleShift,
  startOfWeekInTimeZone,
  totalMinutes,
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

// A location only enforces the geofence once someone has set its pin.
function geofencePin(location: LocationRow | null) {
  if (location?.latitude == null || location?.longitude == null) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    radiusM: location.clock_in_radius_m,
  };
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

  return {
    linked: true,
    employeeName: employee.name,
    department: employee.department,
    locationName: employee.locations?.name ?? null,
    // True when clock-in requires the phone's location (store has a pin).
    geofenced: geofencePin(employee.locations) !== null,
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
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const employee = await findEmployee(user.email);
    if (!employee) return NextResponse.json({ linked: false });
    return NextResponse.json(await buildStatus(employee, new Date()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load clock status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    action?: string;
    clockOutAt?: string;
    position?: { latitude?: number; longitude?: number; accuracy?: number };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const employee = await findEmployee(user.email);
    if (!employee) {
      return NextResponse.json(
        { error: "Your login isn't linked to an employee profile. Ask your manager to add your email on the Employees page." },
        { status: 403 },
      );
    }

    const sb = getSupabase();
    const now = new Date();
    const open = await findOpenEntry(employee.id);

    if (body.action === "in") {
      if (open) {
        return NextResponse.json(
          { error: "You already have a running shift.", code: open && isStaleShift(open.clock_in_at, now) ? "stale" : "already_open" },
          { status: 409 },
        );
      }
      // Geofence: only enforced when the employee's store has a pin set.
      const pin = geofencePin(employee.locations);
      let clockInDistanceM: number | null = null;
      if (pin) {
        const { latitude, longitude, accuracy } = body.position ?? {};
        if (typeof latitude !== "number" || typeof longitude !== "number") {
          return NextResponse.json(
            {
              error: `Clocking in at ${employee.locations?.name ?? "your store"} needs your location. Allow location access and try again.`,
              code: "location_required",
            },
            { status: 400 },
          );
        }
        const check = checkGeofence({ latitude, longitude, accuracy }, pin);
        if (!check.ok) {
          return NextResponse.json(
            {
              error: `You look ${formatDistance(check.distanceM)} from ${employee.locations?.name ?? "your store"} — clock in when you arrive.`,
              code: "too_far",
            },
            { status: 403 },
          );
        }
        clockInDistanceM = check.distanceM;
      }

      const { error } = await sb.from("time_entries").insert({
        employee_id: employee.id,
        location_name: employee.locations?.name ?? null,
        clock_in_at: now.toISOString(),
        clock_in_distance_m: clockInDistanceM,
      });
      // 23505 = unique violation on the one-open-shift index (double-tap race).
      if (error && error.code !== "23505") throw new Error(error.message);
      return NextResponse.json(await buildStatus(employee, now));
    }

    if (body.action === "out") {
      if (!open) {
        return NextResponse.json({ error: "You're not clocked in.", code: "not_open" }, { status: 409 });
      }
      if (isStaleShift(open.clock_in_at, now)) {
        return NextResponse.json(
          { error: "This shift ran too long — confirm when it really ended.", code: "stale" },
          { status: 409 },
        );
      }
      const { error } = await sb
        .from("time_entries")
        .update({ clock_out_at: now.toISOString() })
        .eq("id", open.id)
        .is("clock_out_at", null);
      if (error) throw new Error(error.message);
      return NextResponse.json(await buildStatus(employee, now));
    }

    if (body.action === "resolve") {
      if (!open) {
        return NextResponse.json({ error: "There's no shift to fix.", code: "not_open" }, { status: 409 });
      }
      const clockOutAt = body.clockOutAt ?? "";
      const invalid = validateSelfReportedClockOut(open.clock_in_at, clockOutAt, now);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      const { error } = await sb
        .from("time_entries")
        .update({
          clock_out_at: new Date(clockOutAt).toISOString(),
          flagged: true,
          flag_reason: "Self-reported end time after a forgotten clock-out",
        })
        .eq("id", open.id)
        .is("clock_out_at", null);
      if (error) throw new Error(error.message);
      return NextResponse.json(await buildStatus(employee, now));
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clock action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
