import { validateGlassPolicy } from "@/lib/purchasing/policy";
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
    if (body.glass_policy !== undefined) {
      if (!validateGlassPolicy(body.glass_policy)) return NextResponse.json({ error: "Invalid glass planning policy" }, { status: 400 });
      payload.glass_policy = body.glass_policy;
    }
    if (body.expected_fill !== undefined)
      payload.expected_fill = Number(body.expected_fill);
    if (body.lead_time_days !== undefined) {
      const lead = body.lead_time_days;
      if (typeof lead !== "number" || !Number.isInteger(lead) || lead < 1 || lead > 365) return NextResponse.json({ error: "Lead time must be a whole number from 1 to 365" }, { status: 400 });
      payload.lead_time_days = lead;
    }
    if (body.crate_size !== undefined) {
      const crate = body.crate_size;
      if (typeof crate !== "number" || !Number.isInteger(crate) || crate < 1 || crate > 1000) return NextResponse.json({ error: "Crate size must be a whole number from 1 to 1000" }, { status: 400 });
      payload.crate_size = crate;
    }
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
    if (body.restock_cover_pct !== undefined) {
      const n = Number(body.restock_cover_pct);
      if (!Number.isFinite(n) || n < 0 || n > 500) {
        return NextResponse.json(
          { error: "restock_cover_pct must be a number between 0 and 500" },
          { status: 400 },
        );
      }
      payload.restock_cover_pct = n;
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
        "expected_fill, lead_time_days, crate_size, season_multipliers, annual_growth_pct, restock_cover_pct, glass_policy",
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
        { ...before, glass_policy: JSON.stringify(before.glass_policy) },
        { ...payload, ...(payload.glass_policy ? { glass_policy: JSON.stringify(payload.glass_policy) } : {}) },
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
