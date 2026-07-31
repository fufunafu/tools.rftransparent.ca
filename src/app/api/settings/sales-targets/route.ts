import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { recordSettingChange } from "@/lib/settings-audit";
import { getSalesTargets, putSalesTargets, type SalesTargets } from "@/lib/settings";
import { getStores } from "@/lib/shopify";

export const dynamic = "force-dynamic";

// Monthly net-revenue target per store, the number the operations dashboard
// measures "30d vs target" against. Lives in app_settings rather than the
// pipeline forecast, so it is a figure someone committed to rather than a
// prediction that moves on its own.

export async function GET() {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ targets: await getSalesTargets() });
}

export async function PUT(req: NextRequest) {
  // Targets decide whether the whole company reads as green or red, so
  // editing is admin-only even though anyone signed in may read them.
  const user = await getAuthenticatedUser();
  if (!user?.email || !(await isAdminUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const incoming = body?.targets;
  if (!incoming || typeof incoming !== "object")
    return NextResponse.json({ error: "targets object is required" }, { status: 400 });

  const known = new Set(getStores().map((s) => s.id));
  const clean: SalesTargets = {};
  for (const [storeId, raw] of Object.entries(incoming)) {
    if (!known.has(storeId)) continue;
    const value = typeof raw === "string" ? Number(raw.replace(/[^0-9.]/g, "")) : Number(raw);
    // A blank or zero target means "no target" — the dashboard renders that
    // store neutral rather than measuring it against nothing.
    if (Number.isFinite(value) && value > 0) clean[storeId] = Math.round(value);
  }

  const before = await getSalesTargets();
  await putSalesTargets(clean);

  const changes = getStores()
    .filter((s) => (before[s.id] ?? 0) !== (clean[s.id] ?? 0))
    .map((s) => {
      const from = before[s.id] ? `$${before[s.id].toLocaleString()}` : "none";
      const to = clean[s.id] ? `$${clean[s.id].toLocaleString()}` : "none";
      return `${s.label} ${from} → ${to}`;
    });

  if (changes.length > 0) {
    await recordSettingChange({
      area: "rates",
      actor: user.email,
      summary: `Monthly sales target: ${changes.join("; ")}`,
    });
  }

  return NextResponse.json({ targets: clean });
}
