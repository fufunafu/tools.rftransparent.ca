import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getPurchasingSettings } from "@/lib/purchasing/queries";
import { buildFieldDiffs, logActivity } from "@/lib/purchasing/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const settings = await getPurchasingSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load settings" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isManagementUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const user = await getAuthenticatedUser();
  try {
    const body = await req.json();
    const payload: Record<string, unknown> = {};
    if (body.expected_fill !== undefined)
      payload.expected_fill = Number(body.expected_fill);
    if (body.lead_time_days !== undefined)
      payload.lead_time_days = parseInt(body.lead_time_days, 10);
    if (body.crate_size !== undefined)
      payload.crate_size = Number(body.crate_size);
    if (body.annual_growth_pct !== undefined) {
      const n = Number(body.annual_growth_pct);
      if (!Number.isFinite(n) || n < -100 || n > 1000) {
        return NextResponse.json(
          { error: "annual_growth_pct must be a number between -100 and 1000" },
          { status: 400 },
        );
      }
      payload.annual_growth_pct = n;
    }
    if (body.season_multipliers !== undefined) {
      const raw = body.season_multipliers;
      if (!Array.isArray(raw) || raw.length !== 12) {
        return NextResponse.json(
          { error: "season_multipliers must be an array of 12 numbers" },
          { status: 400 },
        );
      }
      const arr = raw.map((n) => Number(n));
      if (arr.some((n) => !Number.isFinite(n) || n <= 0)) {
        return NextResponse.json(
          { error: "every month multiplier must be a positive number" },
          { status: 400 },
        );
      }
      payload.season_multipliers = arr;
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }
    const supabase = getSupabase();
    const { data: before } = await supabase
      .from("purchasing_settings")
      .select(
        "expected_fill, lead_time_days, crate_size, season_multipliers, annual_growth_pct",
      )
      .eq("id", 1)
      .maybeSingle();

    const { error } = await supabase
      .from("purchasing_settings")
      .update(payload)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    revalidateTag("purchasing", "max");

    if (before) {
      const diffs = buildFieldDiffs(
        before as unknown as Record<string, unknown>,
        payload,
        {
          event_type: "settings_update",
          actor_email: user?.email?.toLowerCase() ?? null,
        },
      );
      for (const d of diffs) await logActivity(d);
    }

    return NextResponse.json({ status: "success" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}
