import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import { mobileRoleActions } from "@/lib/mobile-home";
import type { MobileHomeState } from "@/lib/mobile-types";
import { getSupabase } from "@/lib/supabase";
import {
  dayKeyInTimeZone,
  isStaleShift,
  startOfWeekInTimeZone,
  totalMinutes,
  weekDays,
  type ClockEntry,
} from "@/lib/time-clock";

const NO_STORE = { "Cache-Control": "private, no-store" };

interface TaskRow {
  due_at: string | null;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const employee = await findActiveEmployeeByEmail(user.email);
    const now = new Date();
    const weekStart = startOfWeekInTimeZone(now);
    const supabase = getSupabase();

    const tasksRequest = supabase
      .from("todos")
      .select("due_at")
      .eq("created_by", user.email.toLowerCase())
      .eq("completed", false)
      .limit(500);
    const clockRequest = employee
      ? supabase
          .from("time_entries")
          .select("id, clock_in_at, clock_out_at, flagged")
          .eq("employee_id", employee.id)
          .gte("clock_in_at", weekStart.toISOString())
          .order("clock_in_at", { ascending: true })
      : Promise.resolve({ data: [], error: null });
    const openRequest = employee
      ? supabase
          .from("time_entries")
          .select("id, clock_in_at, clock_out_at, flagged")
          .eq("employee_id", employee.id)
          .is("clock_out_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [tasksResult, clockResult, openResult] = await Promise.all([
      tasksRequest,
      clockRequest,
      openRequest,
    ]);
    if (tasksResult.error) throw new Error(tasksResult.error.message);
    if (clockResult.error) throw new Error(clockResult.error.message);
    if (openResult.error) throw new Error(openResult.error.message);

    const tasks = (tasksResult.data ?? []) as TaskRow[];
    const today = dayKeyInTimeZone(now, BUSINESS_TIMEZONE);
    const entries = (clockResult.data ?? []) as ClockEntry[];
    const open = (openResult.data as ClockEntry | null) ?? null;
    if (open && !entries.some((entry) => entry.id === open.id)) entries.push(open);

    const response: MobileHomeState = {
      profile: employee
        ? {
            id: employee.id,
            name: employee.name,
            department: employee.department,
            locationName: employee.location?.name ?? null,
          }
        : null,
      clock: {
        linked: Boolean(employee),
        open: open
          ? {
              id: open.id,
              clockInAt: open.clock_in_at,
              stale: isStaleShift(open.clock_in_at, now),
            }
          : null,
        week: weekDays(entries, now),
        weekMinutes: totalMinutes(
          entries.filter((entry) => Date.parse(entry.clock_in_at) >= weekStart.getTime()),
          now,
        ),
      },
      tasks: {
        active: tasks.length,
        dueToday: tasks.filter((task) => task.due_at === today).length,
        overdue: tasks.filter((task) => task.due_at !== null && task.due_at < today).length,
      },
      roleActions: mobileRoleActions(employee?.department),
    };

    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to load mobile home", error);
    return NextResponse.json(
      { error: "Your daily view is temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
