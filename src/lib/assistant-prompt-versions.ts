import { getSupabase } from "@/lib/supabase";

// Every saved assistant initial prompt, so an edit is recoverable. Same
// contract as settings-audit: the table's migration is applied by hand, so
// writing is best-effort and NEVER throws, and reads report tableMissing
// instead of failing the page.

export interface AssistantPromptVersion {
  id: string;
  prompt: string;
  created_by: string;
  created_at: string;
}

export async function recordAssistantPromptVersion(version: {
  prompt: string;
  actor: string;
}): Promise<void> {
  try {
    const { error } = await getSupabase().from("assistant_prompt_versions").insert({
      prompt: version.prompt,
      created_by: version.actor,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("[assistant-prompt-versions] could not record version:", e);
  }
}

export async function listAssistantPromptVersions(
  limit = 20,
): Promise<{ versions: AssistantPromptVersion[]; tableMissing: boolean }> {
  try {
    const { data, error } = await getSupabase()
      .from("assistant_prompt_versions")
      .select("id, prompt, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { versions: [], tableMissing: true };
    return { versions: (data ?? []) as AssistantPromptVersion[], tableMissing: false };
  } catch {
    return { versions: [], tableMissing: true };
  }
}
