import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  assistantKnowledgeInputSchema,
  listAssistantKnowledge,
} from "@/lib/assistant-knowledge";
import { getSupabase } from "@/lib/supabase";
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

  try {
    return NextResponse.json({ entries: await listAssistantKnowledge() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load knowledge" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = assistantKnowledgeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid knowledge entry" },
      { status: 400 },
    );
  }

  const actor = gate.user.email ?? "unknown";
  const now = new Date().toISOString();
  const { id, ...input } = parsed.data;
  const supabase = getSupabase();

  if (id) {
    const { data, error } = await supabase
      .from("assistant_knowledge")
      .update({ ...input, updated_by: actor, updated_at: now })
      .eq("id", id)
      .select("id, title, content, category, department, location, keywords, active, created_by, updated_by, created_at, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await recordSettingChange({
      area: "assistant",
      actor,
      summary: `Updated assistant knowledge: ${input.title}`,
    });
    return NextResponse.json({ entry: data });
  }

  const { data, error } = await supabase
    .from("assistant_knowledge")
    .insert({ ...input, created_by: actor, updated_by: actor })
    .select("id, title, content, category, department, location, keywords, active, created_by, updated_by, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordSettingChange({
    area: "assistant",
    actor,
    summary: `Added assistant knowledge: ${input.title}`,
  });
  return NextResponse.json({ entry: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("assistant_knowledge")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("assistant_knowledge").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordSettingChange({
    area: "assistant",
    actor: gate.user.email ?? "unknown",
    summary: `Deleted assistant knowledge: ${existing?.title ?? id}`,
  });
  return NextResponse.json({ deleted: true });
}
