import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  listAssistantEvaluationCases,
  searchAssistantKnowledge,
} from "@/lib/assistant-knowledge";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({ id: z.string().uuid().optional() });
const resultSchema = z.object({
  answer: z.string(),
  passed: z.boolean(),
  reason: z.string(),
  model: z.string().nullable().optional(),
});

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

  const invoiceBoxUrl = (
    process.env.INVOICEBOX_URL ?? "https://invoicebox-delta.vercel.app"
  ).replace(/\/+$/, "");
  const results = [];

  for (const item of cases) {
    try {
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
          question: item.question,
          expectedAnswer: item.expected_answer,
          employee: {
            name: "Evaluation Employee",
            department: item.department,
            location: item.location,
          },
          knowledge,
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
      const { error: runError } = await getSupabase().from("assistant_evaluation_runs").insert({
        case_id: item.id,
        answer: result.answer,
        passed: result.passed,
        reason: result.reason,
        model: result.model ?? null,
        run_by: user.email ?? "unknown",
      });
      if (runError) throw new Error(`Could not store evaluation result: ${runError.message}`);
      results.push({ id: item.id, ...result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Evaluation failed";
      const { error: runError } = await getSupabase().from("assistant_evaluation_runs").insert({
        case_id: item.id,
        answer: "",
        passed: false,
        reason,
        model: null,
        run_by: user.email ?? "unknown",
      });
      if (runError) {
        console.error(`[assistant-evaluation] Could not store failed result: ${runError.message}`);
      }
      results.push({ id: item.id, answer: "", passed: false, reason, model: null });
    }
  }

  return NextResponse.json({ results });
}
