import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isAuthenticated } from "@/lib/admin-auth";
import FollowUpDashboard from "@/components/admin/FollowUpDashboard";

export const metadata: Metadata = {
  title: "Follow-up | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function FollowUpPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  const hdrs = await headers();
  const region = hdrs.get("x-vercel-ip-region") || "";
  const defaultStore = region === "QC" ? "store3" : "store1";

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <FollowUpDashboard defaultStore={defaultStore} />
    </div>
  );
}
