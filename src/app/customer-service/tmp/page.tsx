import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import LeadsCombinedDashboard from "@/components/admin/LeadsCombinedDashboard";
import { DEFAULT_LEAD_STORE, LEAD_STORE_COOKIE, isLeadStoreId } from "@/lib/customer-service/lead-store";

// TEMPORARY: the Leads page with the Follow-up page folded in, on real data.
// Reads through /api/customer-service/leads-combined and writes through the
// existing Leads and Follow-up endpoints. Remove this route, the nav entry in
// nav-items.tsx, the API route, the dashboard component and
// src/lib/customer-service/leads-combined.ts once the real merge ships.

export const metadata: Metadata = {
  title: "Leads (TMP) | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function LeadsTmpPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  // Same cookie the Leads and Phones store switchers set.
  const saved = (await cookies()).get(LEAD_STORE_COOKIE)?.value;
  const initialStore = isLeadStoreId(saved) ? saved : DEFAULT_LEAD_STORE;

  return (
    <div className="mx-auto max-w-[1900px] space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          TMP
        </span>
        <span>
          Leads and Follow-up on one page, using real data from both. Logging a follow-up or
          changing an outcome here saves for real and shows on the original pages.
        </span>
      </div>
      <LeadsCombinedDashboard initialStore={initialStore} />
    </div>
  );
}
