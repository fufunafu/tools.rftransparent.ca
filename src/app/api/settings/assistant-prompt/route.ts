import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  assistantInitialPromptSchema,
  getAssistantInitialPrompt,
  putAssistantInitialPrompt,
} from "@/lib/assistant-prompt";
import {
  listAssistantPromptVersions,
  recordAssistantPromptVersion,
} from "@/lib/assistant-prompt-versions";
import { recordSettingChange } from "@/lib/settings-audit";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getAuthenticatedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await isAdminUser())) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  return NextResponse.json({ initialPrompt: await getAssistantInitialPrompt() });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = assistantInitialPromptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid initial prompt" },
      { status: 400 },
    );
  }

  try {
    // On the very first save after history exists, capture the prompt being
    // replaced too, so it stays recoverable.
    const { versions, tableMissing } = await listAssistantPromptVersions(1);
    if (!tableMissing && versions.length === 0) {
      await recordAssistantPromptVersion({
        prompt: await getAssistantInitialPrompt(),
        actor: "system (pre-history)",
      });
    }

    const initialPrompt = await putAssistantInitialPrompt(parsed.data.initialPrompt);
    await recordAssistantPromptVersion({
      prompt: initialPrompt,
      actor: gate.user.email ?? "unknown",
    });
    await recordSettingChange({
      area: "assistant",
      actor: gate.user.email ?? "unknown",
      summary: "Updated the assistant initial prompt",
    });
    return NextResponse.json({ initialPrompt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save initial prompt" },
      { status: 500 },
    );
  }
}
