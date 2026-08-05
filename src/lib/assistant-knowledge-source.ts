import { createHash } from "node:crypto";
import { getSupabase } from "@/lib/supabase";

export async function saveAssistantKnowledgeSource({
  id,
  title,
  sourceKind,
  content,
  refinement,
  actor,
}: {
  id?: string;
  title: string;
  sourceKind: "text" | "transcript" | "email" | "document";
  content: string;
  refinement?: string;
  actor: string;
}): Promise<string> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (id) {
    if (!refinement) return id;
    const { data: existing, error: readError } = await supabase
      .from("assistant_knowledge_sources")
      .select("id, refinements")
      .eq("id", id)
      .maybeSingle();
    if (readError || !existing) {
      throw new Error(`Could not load knowledge source: ${readError?.message ?? "Not found"}`);
    }
    const refinements = Array.isArray(existing.refinements)
      ? existing.refinements.filter((value): value is string => typeof value === "string")
      : [];
    const { error } = await supabase
      .from("assistant_knowledge_sources")
      .update({ refinements: [...refinements, refinement], updated_by: actor, updated_at: now })
      .eq("id", id);
    if (error) throw new Error(`Could not update knowledge source: ${error.message}`);
    return id;
  }

  const { data, error } = await supabase
    .from("assistant_knowledge_sources")
    .insert({
      title: title.trim().slice(0, 240),
      source_kind: sourceKind,
      content,
      content_hash: createHash("sha256").update(content).digest("hex"),
      refinements: refinement ? [refinement] : [],
      created_by: actor,
      updated_by: actor,
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    throw new Error(`Could not store knowledge source: ${error?.message ?? "No ID returned"}`);
  }
  return data.id as string;
}
