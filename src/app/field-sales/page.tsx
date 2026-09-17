import type { Metadata } from "next";
import { redirect } from "next/navigation";
import FieldSalesWorkspace from "@/components/FieldSalesWorkspace";
import { canAccessFieldSales, getFieldSalesActor } from "@/lib/field-sales-access";
import { loadFieldSalesPayload } from "@/lib/field-sales-data";
import type { FieldSalesPayload } from "@/lib/field-sales-types";

export const metadata: Metadata = {
  title: "Field Sales",
  description: "Plan and document customer visits in RF Tools.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FieldSalesPage() {
  const actor = await getFieldSalesActor();
  if (!actor) redirect("/login");
  if (!canAccessFieldSales(actor)) redirect("/access-denied");

  const initialScope = actor.canUsePersonalWorkspace ? "mine" : "team";
  let initialData: FieldSalesPayload | null = null;
  let initialError: string | null = null;
  try {
    initialData = await loadFieldSalesPayload(actor, initialScope, null);
  } catch (error) {
    console.error("Failed to render field sales workspace", error);
    initialError = "Field sales is not ready yet. Apply the field-sales database migration, then reload this page.";
  }

  return <FieldSalesWorkspace initialData={initialData} initialError={initialError} initialScope={initialScope} />;
}
