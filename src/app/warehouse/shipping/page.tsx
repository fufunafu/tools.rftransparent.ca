import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { canViewShippingQuotes } from "@/lib/shipping-quotes-access";
import ShippingQuotes from "@/components/warehouse/ShippingQuotes";

export const metadata: Metadata = {
  title: "Shipping Quotes | Logistics | RF Tools",
  robots: { index: false, follow: false },
};

export default async function ShippingQuotesPage() {
  const user = await getAuthenticatedUser();
  if (!user?.email) redirect("/login");
  if (!(await canViewShippingQuotes())) redirect("/access-denied");
  const canEdit = await isManagementUser();
  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <ShippingQuotes canEdit={canEdit} />
    </div>
  );
}
