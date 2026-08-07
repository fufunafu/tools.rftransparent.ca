import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  listAssistantKnowledgeGaps,
  updateAssistantKnowledgeGapStatus,
} from "@/lib/assistant-knowledge";
import { recordSettingChange } from "@/lib/settings-audit";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(["open", "dismissed", "resolved"]),
  knowledgeId: z.string().uuid().optional(),
  // Only used for the audit sentence; the update itself works off ids.
  message: z.string().trim().max(2000).optional(),
});

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

  try {
    const { gaps, statusSupported } = await listAssistantKnowledgeGaps();
    return NextResponse.json({ gaps, statusSupported });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load gaps" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid gap update" }, { status: 400 });
  }

  const actor = gate.user.email ?? "unknown";
  try {
    await updateAssistantKnowledgeGapStatus({
      ids: parsed.data.ids,
      status: parsed.data.status,
      actor,
      knowledgeId: parsed.data.knowledgeId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update gap";
    const migrationMissing = message.includes("assistant_gap_status migration");
    return NextResponse.json({ error: message }, { status: migrationMissing ? 409 : 500 });
  }

  const label = parsed.data.message ? `: "${parsed.data.message.slice(0, 80)}"` : "";
  const verb = parsed.data.status === "dismissed"
    ? "Dismissed"
    : parsed.data.status === "resolved"
      ? "Resolved"
      : "Reopened";
  await recordSettingChange({
    area: "assistant",
    actor,
    summary: `${verb} assistant gap${label}`,
  });

  return NextResponse.json({ updated: true });
}
