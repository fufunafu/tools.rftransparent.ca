import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/admin-auth";
import {
  listAssistantEvaluationCases,
  listAssistantKnowledgeGaps,
} from "@/lib/assistant-knowledge";
import { getAssistantInitialPrompt } from "@/lib/assistant-prompt";
import { isAdminEmail } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [initialPrompt, evaluations, gapsResult] = await Promise.all([
      getAssistantInitialPrompt(),
      listAssistantEvaluationCases(),
      listAssistantKnowledgeGaps(),
    ]);
    return NextResponse.json({
      initialPrompt,
      evaluations,
      gaps: gapsResult.gaps,
      gapStatusSupported: gapsResult.statusSupported,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load assistant settings" },
      { status: 500 },
    );
  }
}
