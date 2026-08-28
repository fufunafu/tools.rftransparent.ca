import "server-only";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";

/**
 * Who may see shipping quotes: warehouse staff (they pack and ship) and
 * management (which implies admin). Same shape as the Daily Report gate.
 */
export async function canViewShippingQuotes(): Promise<boolean> {
  const user = await getAuthenticatedUser();
  if (!user?.email) return false;
  const employee = await findActiveEmployeeByEmail(user.email);
  if (employee?.department === "warehouse") return true;
  return isManagementUser();
}
