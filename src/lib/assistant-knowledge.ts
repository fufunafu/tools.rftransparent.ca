import { z } from "zod";
import { createAssistantEmbedding } from "@/lib/assistant-embeddings";
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
export const ASSISTANT_KNOWLEDGE_SOURCE_MAX_LENGTH = 120000;

export type AssistantCategory = (typeof ASSISTANT_CATEGORIES)[number];

export interface AssistantKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: AssistantCategory;
  department: string | null;
  location: string | null;
  keywords: string[];
  source_id: string | null;
  source_title: string | null;
  source_excerpt: string | null;
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
  source_id: string | null;
  source_title: string | null;
  source_excerpt: string | null;
  rank: number;
}

export interface AssistantKnowledgeGap {
  id: string;
  message: string;
  rewritten_query: string;
  department: string | null;
  location: string | null;
  created_at: string;
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
  source_id: z.string().uuid().nullable().optional(),
  source_excerpt: z.string().trim().max(1000).nullable().optional(),
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
    .select("id, title, content, category, department, location, keywords, source_id, source_excerpt, assistant_knowledge_sources(title), active, created_by, updated_by, created_at, updated_at")
    .order("active", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Could not load assistant knowledge: ${error.message}`);
  return (data ?? []).map((item) => {
    const source = item.assistant_knowledge_sources as { title?: string | null } | null;
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      category: item.category,
      department: item.department,
      location: item.location,
      keywords: item.keywords,
      source_id: item.source_id,
      source_title: source?.title ?? null,
      source_excerpt: item.source_excerpt,
      active: item.active,
      created_by: item.created_by,
      updated_by: item.updated_by,
      created_at: item.created_at,
      updated_at: item.updated_at,
    } as AssistantKnowledgeEntry;
  });
}

export async function searchAssistantKnowledge(
  query: string,
  context: { department?: string | null; location?: string | null },
  limit = 5,
): Promise<AssistantKnowledgeMatch[]> {
  const searchQuery = buildAssistantSearchQuery(query);
  if (!searchQuery) return [];

  const supabase = getSupabase();
  try {
    const { embedding } = await createAssistantEmbedding(query);
    const { data, error } = await supabase.rpc("search_assistant_knowledge_hybrid", {
      query_text: searchQuery,
      query_embedding: embedding,
      employee_department: context.department ?? null,
      employee_location: context.location ?? null,
      result_limit: limit,
    });
    if (!error) return (data ?? []) as AssistantKnowledgeMatch[];
    console.error("[whatsapp-assistant] Hybrid search failed:", error.message);
  } catch (error) {
    console.error(
      "[whatsapp-assistant] Embedding search failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const { data, error } = await supabase.rpc("search_assistant_knowledge", {
      query_text: searchQuery,
      employee_department: context.department ?? null,
      employee_location: context.location ?? null,
      result_limit: limit,
    });

  if (error) throw new Error(`Could not search assistant knowledge: ${error.message}`);
  return (data ?? []).map((item: Record<string, unknown>) => ({
    ...item,
    source_id: null,
    source_title: null,
    source_excerpt: null,
  })) as AssistantKnowledgeMatch[];
}

export async function listAssistantKnowledgeForContext(
  context: { department?: string | null; location?: string | null },
  limit = 20,
): Promise<AssistantKnowledgeMatch[]> {
  const entries = await listAssistantKnowledge();
  return entries
    .filter((entry) => entry.active)
    .filter((entry) => scopeMatches(entry.department, context.department ?? null))
    .filter((entry) => scopeMatches(entry.location, context.location ?? null))
    .slice(0, Math.min(Math.max(limit, 1), 20))
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      department: entry.department,
      location: entry.location,
      keywords: entry.keywords,
      source_id: entry.source_id,
      source_title: entry.source_title,
      source_excerpt: entry.source_excerpt,
      rank: 0,
    }));
}

export async function recordAssistantKnowledgeQuery(input: {
  employeeId: string | null;
  message: string;
  rewrittenQuery: string;
  department: string | null;
  location: string | null;
  matches: AssistantKnowledgeMatch[];
}): Promise<void> {
  const { error } = await getSupabase().from("assistant_knowledge_queries").insert({
    employee_id: input.employeeId,
    message: input.message,
    rewritten_query: input.rewrittenQuery,
    department: input.department,
    location: input.location,
    result_count: input.matches.length,
    top_score: input.matches[0]?.rank ?? null,
    matched: input.matches.length > 0,
    knowledge_ids: input.matches.map((match) => match.id),
  });
  if (error) throw new Error(`Could not record knowledge query: ${error.message}`);
}

export async function listAssistantKnowledgeGaps(limit = 50): Promise<AssistantKnowledgeGap[]> {
  const { data, error } = await getSupabase()
    .from("assistant_knowledge_queries")
    .select("id, message, rewritten_query, department, location, created_at")
    .eq("matched", false)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`Could not load knowledge gaps: ${error.message}`);
  return (data ?? []) as AssistantKnowledgeGap[];
}

export function buildAssistantSearchQuery(query: string): string {
  const words = query
    .toLocaleLowerCase("en-CA")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 2))]
    .slice(0, 20)
    .join(" OR ");
}

function scopeMatches(required: string | null, actual: string | null): boolean {
  if (!required) return true;
  return Boolean(actual && required.localeCompare(actual, "en-CA", { sensitivity: "base" }) === 0);
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
