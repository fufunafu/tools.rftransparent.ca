import "server-only";
import { cache } from "react";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";

export const canAccessCrm = cache(async (): Promise<boolean> => {
  const user = await getAuthenticatedUser();
  if (!user?.email) return false;
  if (await isManagementUser()) return true;
  try {
    const employee = await findActiveEmployeeByEmail(user.email);
    return employee?.department === "sales" || employee?.department === "customer_service";
  } catch { return false; }
});
