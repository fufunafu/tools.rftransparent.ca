import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import FollowUpTestDashboard from "@/components/admin/followup/FollowUpTestDashboard";

export const metadata: Metadata = {
  title: "Follow-up Test Mode | Customer Service | RF Tools",
  robots: { index: false, follow: false },
};

export default async function FollowUpTestPage() {
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <div className="max-w-[1400px] mx-auto">
      <FollowUpTestDashboard />
    </div>
  );
}
