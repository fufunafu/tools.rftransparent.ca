import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import { listAssistantActivity } from "@/lib/assistant-knowledge";
import { isAdminEmail } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const days = Number.parseInt(params.get("days") ?? "30", 10);
  const department = params.get("department") || null;
  const matchedParam = params.get("matched");
  const matched = matchedParam === "yes" ? true : matchedParam === "no" ? false : null;

  try {
    const { queries, usage } = await listAssistantActivity({
      days: Number.isFinite(days) ? days : 30,
      department,
      matched,
    });
    return NextResponse.json({ queries, usage });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load assistant activity" },
      { status: 500 },
    );
  }
}
