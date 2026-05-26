import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser, isManagementUser } from "@/lib/admin-auth";

// Small "who am I" probe for the client. Clients use this to decide whether
// to render admin-only UI (e.g., the "set password" button on the employee
// drawer). The server still re-checks on every mutation — this endpoint is
// purely cosmetic.
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [isAdmin, isManagement] = await Promise.all([
    isAdminUser(),
    isManagementUser(),
  ]);

  return NextResponse.json({
    email: user.email,
    isAdmin,
    isManagement,
  });
}
