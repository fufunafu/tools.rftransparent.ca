import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAuthenticated } from "@/lib/admin-auth";
import EmailDashboard from "@/components/admin/EmailDashboard";

export const metadata: Metadata = {
  title: "Emails | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function EmailsPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  const hdrs = await headers();
  const region = hdrs.get("x-vercel-ip-region") || "";
  const defaultStore = region === "QC" ? "bc_transparent" : "rf_transparent";

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <EmailDashboard defaultStore={defaultStore} />
    </div>
  );
}
