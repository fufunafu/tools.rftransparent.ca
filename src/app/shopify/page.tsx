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
    <div className="fixed inset-0 z-50 bg-sand-50 flex flex-col">
      <div className="border-b border-sand-200/60 bg-white px-6 py-3 shrink-0">
        <div className="flex items-center gap-3 max-w-[1600px] mx-auto">
          <a href="/" className="text-lg font-serif font-semibold text-sand-900 hover:text-accent transition-colors">
            RF Transparent
          </a>
          <span className="text-sand-300">/</span>
          <h1 className="text-sm font-medium text-sand-600">Shopify</h1>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-5xl mx-auto">
          <ShopifyDashboard />
        </div>
      </div>
    </div>
  );
}
