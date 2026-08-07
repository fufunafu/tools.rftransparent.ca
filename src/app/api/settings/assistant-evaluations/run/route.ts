import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  listAssistantEvaluationCases,
  searchAssistantKnowledge,
  type AssistantEvaluationCase,
} from "@/lib/assistant-knowledge";
import { formatAssistantKnowledgeContext } from "@/lib/assistant-retrieval";
import { getSupabase } from "@/lib/supabase";
import { getAssistantInitialPrompt } from "@/lib/assistant-prompt";
import { recordSettingChange } from "@/lib/settings-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 3 workers x 60s InvoiceBox timeout stays well inside maxDuration.
const EVALUATION_CONCURRENCY = 3;

const requestSchema = z.object({ id: z.string().uuid().optional() });
const resultSchema = z.object({
  answer: z.string(),
  passed: z.boolean(),
  reason: z.string(),
  model: z.string().nullable().optional(),
});

type RunStatus = "completed" | "error";

interface RunResult {
  id: string;
  answer: string;
  passed: boolean;
  reason: string;
  model: string | null;
  status: RunStatus;
}

function isMissingStatusColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return typeof error.message === "string" && error.message.includes("status");
}

// The status column arrives with a hand-applied migration; retry without it
// so runs keep recording on a database that doesn't have it yet.
async function insertRun(row: {
  case_id: string;
  answer: string;
  passed: boolean;
  reason: string;
  model: string | null;
  run_by: string;
  status: RunStatus;
}): Promise<{ message: string } | null> {
  const legacyRow = {
    case_id: row.case_id,
    answer: row.answer,
    passed: row.passed,
    reason: row.reason,
    model: row.model,
    run_by: row.run_by,
  };
  let { error } = await getSupabase().from("assistant_evaluation_runs").insert(row);
  if (error && isMissingStatusColumn(error)) {
    ({ error } = await getSupabase().from("assistant_evaluation_runs").insert(legacyRow));
  }
  return error ?? null;
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid test id" }, { status: 400 });

  const secret = process.env.WHATSAPP_ASSISTANT_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "WHATSAPP_ASSISTANT_SHARED_SECRET is not configured" },
      { status: 500 },
    );
  }

  const allCases = await listAssistantEvaluationCases();
  const cases = allCases.filter((item) =>
    parsed.data.id ? item.id === parsed.data.id : item.active
  );
  if (cases.length === 0) {
    return NextResponse.json({ error: "No active evaluation cases found" }, { status: 400 });
  }

  const initialPrompt = await getAssistantInitialPrompt();

  const invoiceBoxUrl = (
    process.env.INVOICEBOX_URL ?? "https://invoicebox-delta.vercel.app"
  ).replace(/\/+$/, "");
  const runBy = user.email ?? "unknown";

  async function runCase(item: AssistantEvaluationCase): Promise<RunResult> {
    try {
      // The retrieval query rewrite is intentionally skipped: production only
      // rewrites when conversation history exists, and cases are single questions.
      const knowledge = await searchAssistantKnowledge(item.question, {
        department: item.department,
        location: item.location,
      });
      const response = await fetch(`${invoiceBoxUrl}/api/internal/assistant/evaluate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          initialPrompt,
          question: item.question,
          expectedAnswer: item.expected_answer,
          employee: {
            name: "Evaluation Employee",
            department: item.department,
            location: item.location,
          },
          knowledge,
          knowledgeContext: formatAssistantKnowledgeContext(knowledge),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `InvoiceBox returned HTTP ${response.status}`,
        );
      }

      const result = resultSchema.parse(payload);
      const runError = await insertRun({
        case_id: item.id,
        answer: result.answer,
        passed: result.passed,
        reason: result.reason,
        model: result.model ?? null,
        run_by: runBy,
        status: "completed",
      });
      if (runError) throw new Error(`Could not store evaluation result: ${runError.message}`);
      return { id: item.id, ...result, model: result.model ?? null, status: "completed" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Evaluation failed";
      const runError = await insertRun({
        case_id: item.id,
        answer: "",
        passed: false,
        reason,
        model: null,
        run_by: runBy,
        status: "error",
      });
      if (runError) {
        console.error(`[assistant-evaluation] Could not store failed result: ${runError.message}`);
      }
      return { id: item.id, answer: "", passed: false, reason, model: null, status: "error" };
    }
  }

  const results: RunResult[] = new Array(cases.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < cases.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await runCase(cases[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(EVALUATION_CONCURRENCY, cases.length) }, () => worker()),
  );

  if (!parsed.data.id) {
    const errors = results.filter((result) => result.status === "error").length;
    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed - errors;
    await recordSettingChange({
      area: "assistant",
      actor: runBy,
      summary: `Ran ${results.length} assistant quality checks: ${passed} passed, ${failed} failed, ${errors} errors`,
    });
  }

  return NextResponse.json({ results });
}
