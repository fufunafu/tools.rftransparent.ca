import "server-only";

import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail, type EmployeeProfile } from "@/lib/employee-profile";

export interface FieldSalesActor {
  email: string;
  employee: EmployeeProfile | null;
  canManage: boolean;
  canUsePersonalWorkspace: boolean;
}

export async function getFieldSalesActor(): Promise<FieldSalesActor | null> {
  const user = await getAuthenticatedUser();
  if (!user?.email) return null;
  const [employee, canManage] = await Promise.all([
    findActiveEmployeeByEmail(user.email),
    isManagementUser(),
  ]);
  return {
    email: user.email.toLowerCase(),
    employee,
    canManage,
    canUsePersonalWorkspace: employee?.department === "sales" || employee?.department === "management",
  };
}

export function canAccessFieldSales(actor: FieldSalesActor): boolean {
  return actor.canManage || actor.canUsePersonalWorkspace;
}
