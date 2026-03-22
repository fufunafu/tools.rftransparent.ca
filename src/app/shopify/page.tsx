import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";
import ShopifyDashboard from "@/components/admin/ShopifyDashboard";

export const metadata: Metadata = {
  title: "Shopify | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ShopifyPage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");

  return (
    <div className="max-w-5xl mx-auto">
      <ShopifyDashboard />
    </div>
  );
}
