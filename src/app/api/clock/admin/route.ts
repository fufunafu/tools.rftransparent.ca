import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import {
  startOfWeekInTimeZone,
  timeEntriesCsv,
  type CsvEntry,
} from "@/lib/time-clock";

// Manager side of clock in/out: read everyone's week, export payroll CSV,
// and fix entries. Management only (owner included) — the employee-facing
// route is /api/clock and can only touch the caller's own shifts.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

interface EmployeeRow {
  id: string;
  name: string;
  department: string;
  locations: { name: string } | { name: string }[] | null;
}

function locationName(row: EmployeeRow): string | null {
  const loc = Array.isArray(row.locations) ? row.locations[0] ?? null : row.locations;
  return loc?.name ?? null;
}

export async function GET(req: NextRequest) {
  if (!(await isManagementUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ?start=<ISO of a Monday-midnight instant>; defaults to this week.
  const startParam = req.nextUrl.searchParams.get("start");
  const parsed = startParam ? new Date(startParam) : new Date();
  if (Number.isNaN(parsed.getTime()))
    return NextResponse.json({ error: "Invalid start date" }, { status: 400 });
  const weekStart = startOfWeekInTimeZone(parsed);
  const weekEnd = new Date(weekStart.getTime() + MS_PER_WEEK);

  try {
    const sb = getSupabase();
    const [employeesResult, entriesResult] = await Promise.all([
      sb
        .from("employees")
        .select("id, name, department, locations(name)")
        .eq("active", true)
        .order("name"),
      sb
        .from("time_entries")
        .select("id, employee_id, location_name, clock_in_at, clock_out_at, flagged, flag_reason, edited_by, edit_note")
        .gte("clock_in_at", weekStart.toISOString())
        .lt("clock_in_at", weekEnd.toISOString())
        .order("clock_in_at", { ascending: true }),
    ]);
    if (employeesResult.error) throw new Error(employeesResult.error.message);
    if (entriesResult.error) throw new Error(entriesResult.error.message);

    const employees = (employeesResult.data ?? []) as unknown as EmployeeRow[];
    const entries = entriesResult.data ?? [];

    if (req.nextUrl.searchParams.get("format") === "csv") {
      const nameById = new Map(
        employees.map((e) => [e.id, { name: e.name, department: e.department, location: locationName(e) }]),
      );
      const csvRows: CsvEntry[] = entries.map((e) => {
        const emp = nameById.get(e.employee_id);
        return {
          employeeName: emp?.name ?? "Former employee",
          department: emp?.department ?? "",
          locationName: e.location_name ?? emp?.location ?? null,
          clock_in_at: e.clock_in_at,
          clock_out_at: e.clock_out_at,
          flagged: e.flagged,
          flag_reason: e.flag_reason,
          edit_note: e.edit_note,
        };
      });
      const weekLabel = weekStart.toISOString().slice(0, 10);
      return new NextResponse(timeEntriesCsv(csvRows, new Date()), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="hours-week-${weekLabel}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return NextResponse.json({
      weekStart: weekStart.toISOString(),
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        department: e.department,
        locationName: locationName(e),
      })),
      entries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load hours";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Fix or approve a single entry. Time edits require both timestamps to stay
// sane; every change records who made it and why.
export async function PATCH(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email || !(await isManagementUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    entryId?: string;
    clockInAt?: string;
    clockOutAt?: string;
    note?: string;
    clearFlag?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

  const update: Record<string, unknown> = {
    edited_by: user.email,
    edit_note: body.note?.trim() || (body.clearFlag ? "Approved" : "Adjusted by manager"),
  };

  if (body.clockInAt || body.clockOutAt) {
    const clockIn = Date.parse(body.clockInAt ?? "");
    const clockOut = Date.parse(body.clockOutAt ?? "");
    if (Number.isNaN(clockIn) || Number.isNaN(clockOut))
      return NextResponse.json({ error: "Both clock-in and clock-out times are required for a time edit." }, { status: 400 });
    if (clockOut <= clockIn)
      return NextResponse.json({ error: "Clock-out must be after clock-in." }, { status: 400 });
    if (clockOut - clockIn > 24 * 60 * 60 * 1000)
      return NextResponse.json({ error: "A shift can't be longer than 24 hours." }, { status: 400 });
    update.clock_in_at = new Date(clockIn).toISOString();
    update.clock_out_at = new Date(clockOut).toISOString();
  }
  if (body.clearFlag) update.flagged = false;

  try {
    const { data, error } = await getSupabase()
      .from("time_entries")
      .update(update)
      .eq("id", body.entryId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Remove an entry outright (accidental clock-in). The row is gone but the
// action is deliberate: management-gated and confirmed in the UI.
export async function DELETE(req: NextRequest) {
  if (!(await isManagementUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const entryId = req.nextUrl.searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

  try {
    const { error } = await getSupabase().from("time_entries").delete().eq("id", entryId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
