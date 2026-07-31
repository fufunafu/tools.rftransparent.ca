import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminUser, isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { getStores } from "@/lib/shopify";
import { getPurchasingSettings } from "@/lib/purchasing/queries";
import RatesForm from "@/components/admin/settings/RatesForm";
import SalesTargetsForm from "@/components/admin/settings/SalesTargetsForm";
import ChangeLog from "@/components/admin/settings/ChangeLog";
import { getSettingChanges } from "@/lib/settings-audit";
import { getSalesTargets } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Rates & Thresholds | Settings | RF Tools",
  robots: { index: false, follow: false },
};

// Same defaults kpi-sales.ts falls back to when a store has no saved rates,
// so the page shows the numbers the forecast is actually using.
const HARDCODED_FALLBACK: Record<number, number> = {
  0: -0.55, 1: 0.5, 2: 1.0, 3: 2.0, 4: 1.2, 5: 0.07,
  6: -0.15, 7: -0.06, 8: -0.25, 9: -0.03, 10: -0.08, 11: -0.45,
};

export default async function RatesPage() {
  if (!(await isAuthenticated())) redirect("/login");

  const stores = getStores().map((s) => ({ id: s.id, label: s.label }));

  let byStore: Record<string, Record<number, number>> = {};
  try {
    const { data } = await getSupabase()
      .from("forecast_mom_rates")
      .select("store_id, month_index, mom_rate");
    for (const row of data ?? []) {
      (byStore[row.store_id] ??= {})[row.month_index] = Number(row.mom_rate);
    }
  } catch {
    // Table may not exist in a fresh environment — fall through to defaults.
    byStore = {};
  }

  const [purchasing, canEdit, log, targets] = await Promise.all([
    getPurchasingSettings(),
    isAdminUser(),
    getSettingChanges("rates"),
    getSalesTargets(),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <SalesTargetsForm stores={stores} initial={targets} canEdit={canEdit} />
      <RatesForm
        stores={stores}
        initial={byStore}
        defaults={HARDCODED_FALLBACK}
        canEdit={canEdit}
        purchasing={{
          lead_time_days: purchasing.lead_time_days,
          expected_fill: purchasing.expected_fill,
          crate_size: purchasing.crate_size,
          annual_growth_pct: purchasing.annual_growth_pct,
          restock_cover_pct: purchasing.restock_cover_pct,
        }}
      />
      <ChangeLog changes={log.changes} unavailable={log.tableMissing} />
    </div>
  );
}
