import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAuthenticated } from "@/lib/admin-auth";
import CustomerServiceDashboard from "@/components/admin/CustomerServiceDashboard";

export const metadata: Metadata = {
  title: "Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function CustomerServicePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  // Vercel provides geo headers — default to BC Transparent if user is in Quebec
  const hdrs = await headers();
  const region = hdrs.get("x-vercel-ip-region") || "";
  const defaultStore = region === "QC" ? "bc_transparent" : "rf_transparent";

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <CustomerServiceDashboard defaultStore={defaultStore} />
    </div>
  );
}
