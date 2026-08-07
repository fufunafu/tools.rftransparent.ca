import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { listAssistantPromptVersions } from "@/lib/assistant-prompt-versions";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { versions, tableMissing } = await listAssistantPromptVersions();
  return NextResponse.json({ versions, tableMissing });
}
