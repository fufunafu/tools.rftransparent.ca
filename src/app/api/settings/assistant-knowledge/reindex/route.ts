import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  buildAssistantKnowledgeEmbeddingInput,
  createAssistantEmbeddings,
} from "@/lib/assistant-embeddings";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("assistant_knowledge")
    .select("id, title, content, category, keywords")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const entries = data ?? [];
  if (entries.length === 0) return NextResponse.json({ indexed: 0 });

  try {
    const generated = await createAssistantEmbeddings(
      entries.map(buildAssistantKnowledgeEmbeddingInput),
      createHash("sha256").update(user.email ?? user.id).digest("hex"),
    );
    const embeddedAt = new Date().toISOString();
    for (const [index, entry] of entries.entries()) {
      const { error: updateError } = await supabase
        .from("assistant_knowledge")
        .update({
          embedding: generated.embeddings[index],
          embedding_model: generated.model,
          embedded_at: embeddedAt,
        })
        .eq("id", entry.id);
      if (updateError) throw new Error(updateError.message);
    }
    return NextResponse.json({ indexed: entries.length, model: generated.model });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Could not index answers" },
      { status: 502 },
    );
  }
}
