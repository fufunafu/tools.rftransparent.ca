import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/admin-auth";

export default async function CustomerServicePage() {
  const authenticated = await isAuthenticated();
  if (!authenticated) redirect("/login");
  redirect("/customer-service/phones");
}
