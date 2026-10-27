import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { findActiveEmployeeByEmail } from "@/lib/employee-profile";
import {
  canAccessNativeDestination,
  nativeLinkAccessRequirement,
} from "@/lib/native-link-access";
import { resolveNativeLink } from "@/lib/native-links";
import { RF_TOOLS_ORIGIN } from "@/lib/native-runtime";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const resolution = resolveNativeLink(
    request.nextUrl.searchParams.get("href") ?? "",
  );
  if (resolution.kind !== "destination") {
    return NextResponse.json(resolution, { headers: NO_STORE });
  }

  const pathname = new URL(resolution.href, RF_TOOLS_ORIGIN).pathname;
  const requirement = nativeLinkAccessRequirement(pathname);
  if (requirement === "public") {
    return NextResponse.json(resolution, { headers: NO_STORE });
  }

  const user = await getAuthenticatedUser();
  if (!user?.email) {
    return NextResponse.json(
      { kind: "unauthenticated", href: "/login?error=session_expired" },
      { status: 401, headers: NO_STORE },
    );
  }

  let department: string | null = null;
  let management = false;
  if (requirement !== "authenticated") {
    const needsManagement =
      requirement === "management" ||
      requirement === "sales-or-management" ||
      requirement === "customer-service-or-management";
    const [employee, managementResult] = await Promise.all([
      findActiveEmployeeByEmail(user.email),
      needsManagement ? isManagementUser() : Promise.resolve(false),
    ]);
    department = employee?.department ?? null;
    management = managementResult;
  }

  if (!canAccessNativeDestination(pathname, {
    authenticated: true,
    department,
    management,
  })) {
    return NextResponse.json(
      { kind: "unauthorized", href: "/?native_link=unauthorized" },
      { status: 403, headers: NO_STORE },
    );
  }

  return NextResponse.json(resolution, { headers: NO_STORE });
}
