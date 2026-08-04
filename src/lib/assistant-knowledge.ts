import { z } from "zod";
import { getSupabase } from "@/lib/supabase";

export const ASSISTANT_CATEGORIES = [
  "company",
  "invoices",
  "expenses",
  "time_off",
  "contacts",
  "warehouse",
  "it",
  "hr",
  "other",
] as const;

export const ASSISTANT_INITIAL_PROMPT_MAX_LENGTH = 12000;
export const ASSISTANT_KNOWLEDGE_SOURCE_MAX_LENGTH = 30000;

export type AssistantCategory = (typeof ASSISTANT_CATEGORIES)[number];

export interface AssistantKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: AssistantCategory;
  department: string | null;
  location: string | null;
  keywords: string[];
  active: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantKnowledgeMatch {
  id: string;
  title: string;
  content: string;
  category: AssistantCategory;
  department: string | null;
  location: string | null;
  keywords: string[];
  rank: number;
}

export interface AssistantEvaluationRun {
  id: string;
  case_id: string;
  answer: string;
  passed: boolean;
  reason: string;
  model: string | null;
  run_by: string;
  created_at: string;
}

export interface AssistantEvaluationCase {
  id: string;
  question: string;
  expected_answer: string;
  department: string | null;
  location: string | null;
  active: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  latest_run: AssistantEvaluationRun | null;
}

const optionalScope = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed || null;
  },
  z.string().max(120).nullable().optional(),
);

export const assistantKnowledgeInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(8000),
  category: z.enum(ASSISTANT_CATEGORIES),
  department: optionalScope,
  location: optionalScope,
  keywords: z
    .array(z.string().trim().min(1).max(80))
    .max(30)
    .default([])
    .transform((values) => [...new Set(values.map((value) => value.toLowerCase()))]),
  active: z.boolean().default(true),
});

export const assistantEvaluationInputSchema = z.object({
  id: z.string().uuid().optional(),
  question: z.string().trim().min(1).max(2000),
  expected_answer: z.string().trim().min(1).max(8000),
  department: optionalScope,
  location: optionalScope,
  active: z.boolean().default(true),
});

export async function listAssistantKnowledge(): Promise<AssistantKnowledgeEntry[]> {
  const { data, error } = await getSupabase()
    .from("assistant_knowledge")
    .select("id, title, content, category, department, location, keywords, active, created_by, updated_by, created_at, updated_at")
    .order("active", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Could not load assistant knowledge: ${error.message}`);
  return (data ?? []) as AssistantKnowledgeEntry[];
}

export async function searchAssistantKnowledge(
  query: string,
  context: { department?: string | null; location?: string | null },
  limit = 5,
): Promise<AssistantKnowledgeMatch[]> {
  const searchQuery = buildAssistantSearchQuery(query);
  if (!searchQuery) return [];

  const { data, error } = await getSupabase().rpc("search_assistant_knowledge", {
    query_text: searchQuery,
    employee_department: context.department ?? null,
    employee_location: context.location ?? null,
    result_limit: limit,
  });

  if (error) throw new Error(`Could not search assistant knowledge: ${error.message}`);
  return (data ?? []) as AssistantKnowledgeMatch[];
}

export function buildAssistantSearchQuery(query: string): string {
  const words = query
    .toLocaleLowerCase("en-CA")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 2))]
    .slice(0, 20)
    .join(" OR ");
}

export async function listAssistantEvaluationCases(): Promise<AssistantEvaluationCase[]> {
  const supabase = getSupabase();
  const { data: cases, error: casesError } = await supabase
    .from("assistant_evaluation_cases")
    .select("id, question, expected_answer, department, location, active, created_by, updated_by, created_at, updated_at")
    .order("active", { ascending: false })
    .order("updated_at", { ascending: false });

  if (casesError) {
    throw new Error(`Could not load assistant evaluations: ${casesError.message}`);
  }

  const ids = (cases ?? []).map((item) => item.id as string);
  if (ids.length === 0) return [];

  const { data: runs, error: runsError } = await supabase
    .from("assistant_evaluation_runs")
    .select("id, case_id, answer, passed, reason, model, run_by, created_at")
    .in("case_id", ids)
    .order("created_at", { ascending: false });

  if (runsError) {
    throw new Error(`Could not load assistant evaluation runs: ${runsError.message}`);
  }

  const latestByCase = new Map<string, AssistantEvaluationRun>();
  for (const run of (runs ?? []) as AssistantEvaluationRun[]) {
    if (!latestByCase.has(run.case_id)) latestByCase.set(run.case_id, run);
  }

  return (cases ?? []).map((item) => ({
    ...(item as Omit<AssistantEvaluationCase, "latest_run">),
    latest_run: latestByCase.get(item.id as string) ?? null,
  }));
}
