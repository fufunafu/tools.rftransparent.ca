import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAuthenticated } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import FollowUpDashboard from "@/components/admin/FollowUpDashboard";
import FollowUpTestDashboard from "@/components/admin/followup/FollowUpTestDashboard";
import {
  getFollowupSummary,
  rangeCutoff,
} from "@/lib/customer-service/followup-queries";

export const metadata: Metadata = {
  title: "Follow-up | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function FollowUpPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");

  // Test mode lives as `?test=1` on this same route instead of /test —
  // a separate route in Next 16.2 / Turbopack kept breaking the dev manifest
  // on first visit. Same UX, same URL pattern, no new route file.
  const { test } = await searchParams;
  if (test === "1") {
    return (
      <div className="max-w-[1400px] mx-auto">
        <FollowUpTestDashboard />
      </div>
    );
  }

  const hdrs = await headers();
  const region = hdrs.get("x-vercel-ip-region") || "";
  const defaultStore = region === "QC" ? "store3" : "store1";

  // Fetch the summary for the default store on the server so the dashboard
  // renders metric cards on first paint. The result is cached by
  // unstable_cache (~1ms warm). The dashboard uses this as SWR `fallbackData`
  // for the matching (defaultStore, '1y') key. If the user has a different
  // store saved in localStorage, the dashboard refetches client-side after
  // hydration — they briefly see default-store data, then it updates.
  const cutoff = rangeCutoff("1y");
  const summary = await getFollowupSummary(defaultStore, cutoff).catch(() => null);
  const stores = getStores().map((s) => ({ id: s.id, label: s.label, shop_domain: s.store }));

  const initialSummary = summary
    ? {
        metrics: {
          due_today: summary.due_today,
          overdue: summary.overdue,
          total_active: summary.total_active,
          total_closed: summary.total_closed,
          won_count: summary.won_count,
          lost_count: summary.lost_count,
          conversion_rate: summary.conversion_rate,
          avg_attempts: summary.avg_attempts,
          avg_cycle_won: summary.avg_cycle_won,
          avg_cycle_lost: summary.avg_cycle_lost,
          pipeline_value: summary.pipeline_value,
          won_value: summary.won_value,
        },
        by_status: summary.by_status,
        loss_reasons: summary.loss_reasons,
        lead_distribution: summary.lead_distribution,
        last_synced_at: summary.last_synced_at,
        stores,
      }
    : null;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <FollowUpDashboard
        defaultStore={defaultStore}
        initialSummary={initialSummary}
      />
    </div>
  );
}
