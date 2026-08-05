import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AssistantKnowledgeManager from "@/components/admin/settings/AssistantKnowledgeManager";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  listAssistantEvaluationCases,
  listAssistantKnowledgeGaps,
  listAssistantKnowledge,
} from "@/lib/assistant-knowledge";
import { getAssistantInitialPrompt } from "@/lib/assistant-prompt";
import { getSupabase } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Employee Assistant | Settings",
  robots: { index: false, follow: false },
};

export default async function AssistantKnowledgePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser())) redirect("/access-denied");

  const [initialPrompt, knowledge, evaluations, gaps, employeeResult, locationResult] = await Promise.all([
    getAssistantInitialPrompt(),
    listAssistantKnowledge(),
    listAssistantEvaluationCases(),
    listAssistantKnowledgeGaps(),
    getSupabase().from("employees").select("department").not("department", "is", null),
    getSupabase().from("locations").select("name").order("name"),
  ]);

  const departments = [...new Set(
    (employeeResult.data ?? [])
      .map((item) => item.department as string | null)
      .filter((value): value is string => Boolean(value)),
  )].sort((a, b) => a.localeCompare(b));
  const locations = [...new Set(
    (locationResult.data ?? [])
      .map((item) => item.name as string | null)
      .filter((value): value is string => Boolean(value)),
  )];

  return (
    <AssistantKnowledgeManager
      initialPrompt={initialPrompt}
      initialKnowledge={knowledge}
      initialEvaluations={evaluations}
      initialGaps={gaps}
      departments={departments}
      locations={locations}
    />
  );
}
