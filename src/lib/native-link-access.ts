export type NativeLinkAccessRequirement =
  | "public"
  | "authenticated"
  | "warehouse-employee"
  | "sales-or-management"
  | "customer-service-or-management"
  | "management";

export interface NativeLinkViewer {
  authenticated: boolean;
  department: string | null;
  management: boolean;
}

export function nativeLinkAccessRequirement(
  pathname: string,
): NativeLinkAccessRequirement {
  if (pathname === "/privacy" || pathname === "/support") return "public";
  if (pathname === "/warehouse/report") return "warehouse-employee";
  if (pathname === "/sales") return "sales-or-management";
  if (pathname === "/customer-service") {
    return "customer-service-or-management";
  }
  if (pathname === "/warehouse") {
    return "management";
  }
  // Follow-ups, problem tickets, marketing summaries, and the employee
  // directory are authenticated shared tools. This mirrors their server page
  // guards and keeps role actions and notification destinations reachable.
  return "authenticated";
}

export function canAccessNativeDestination(
  pathname: string,
  viewer: NativeLinkViewer,
): boolean {
  const requirement = nativeLinkAccessRequirement(pathname);
  if (requirement === "public") return true;
  if (!viewer.authenticated) return false;
  if (requirement === "authenticated") return true;
  if (requirement === "warehouse-employee") {
    return viewer.department === "warehouse";
  }
  if (requirement === "sales-or-management") {
    return viewer.department === "sales" || viewer.management;
  }
  if (requirement === "customer-service-or-management") {
    return viewer.department === "customer_service" || viewer.management;
  }
  return viewer.management;
}
