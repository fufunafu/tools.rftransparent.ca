import type { Metadata } from "next";
import { headers } from "next/headers";
import CustomerServiceDashboard from "@/components/admin/CustomerServiceDashboard";

export const metadata: Metadata = {
  title: "Phones | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function PhonesPage() {
  const hdrs = await headers();
  const region = hdrs.get("x-vercel-ip-region") || "";
  const defaultStore = region === "QC" ? "bc_transparent" : "rf_transparent";

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <CustomerServiceDashboard defaultStore={defaultStore} />
    </div>
  );
}
