import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import {
  LEAD_STORE_COOKIE,
  defaultLeadStoreForRegion,
  isLeadStoreId,
  leadsPath,
} from "@/lib/customer-service/lead-store";

// Legacy URL without a store segment. Redirect to the store the visitor last
// used (cookie set by the store switcher), else the region-based default.
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/login");
  const { store: storeParam } = await searchParams;
  if (isLeadStoreId(storeParam)) redirect(leadsPath(storeParam));
  const saved = (await cookies()).get(LEAD_STORE_COOKIE)?.value;
  if (isLeadStoreId(saved)) redirect(leadsPath(saved));
  const region = (await headers()).get("x-vercel-ip-region");
  redirect(leadsPath(defaultLeadStoreForRegion(region)));
}
