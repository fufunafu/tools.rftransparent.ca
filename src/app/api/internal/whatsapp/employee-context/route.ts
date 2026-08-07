import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  isValidWhatsAppAssistantSecret,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp-employee-context";
import {
  recordAssistantKnowledgeQuery,
  listAssistantKnowledgeForContext,
  searchAssistantKnowledge,
  type AssistantKnowledgeMatch,
} from "@/lib/assistant-knowledge";
import { getAssistantInitialPrompt } from "@/lib/assistant-prompt";
import {
  formatAssistantKnowledgeContext,
  isSmalltalkMessage,
  rewriteAssistantRetrievalQuery,
  type AssistantConversationMessage,
} from "@/lib/assistant-retrieval";

export const dynamic = "force-dynamic";

type EmployeeLookupRow = {
  id: string;
  name: string;
  department: string | null;
  phone: string | null;
  locations: { name: string | null } | null;
};

export async function POST(request: Request) {
  if (!isValidWhatsAppAssistantSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    phone?: unknown;
    message?: unknown;
    messages?: unknown;
  } | null;
  const phone = typeof payload?.phone === "string" ? normalizeWhatsAppPhone(payload.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "A valid phone number is required" }, { status: 400 });
  }
  const message = typeof payload?.message === "string" ? payload.message.trim().slice(0, 2000) : "";
  const history = normalizeConversationHistory(payload?.messages);
  const initialPrompt = await getAssistantInitialPrompt();

  const supabase = getSupabase();
  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id, name, department, phone, location_id, locations(name)")
    .eq("active", true)
    .not("phone", "is", null)
    .overrideTypes<EmployeeLookupRow[], { merge: false }>();

  if (employeeError) {
    return NextResponse.json({ error: "Employee lookup failed" }, { status: 500 });
  }

  const employee = (employees ?? []).find((candidate) =>
    typeof candidate.phone === "string" && normalizeWhatsAppPhone(candidate.phone) === phone
  );
  if (!employee) {
    const retrieval = await retrieveKnowledge({
      message,
      history,
      employeeId: null,
      department: null,
      location: null,
      safetyIdentifier: createHash("sha256").update(phone).digest("hex"),
    });
    return NextResponse.json({
      contractVersion: 2,
      initialPrompt,
      employee: null,
      survey: null,
      ...retrievalResponse(retrieval),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: survey, error: surveyError } = await supabase
    .from("employee_surveys")
    .select("token, week_of, responded_at, created_at")
    .eq("employee_id", employee.id)
    .order("week_of", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (surveyError) {
    return NextResponse.json({ error: "Survey lookup failed" }, { status: 500 });
  }

  const location = employee.locations?.name ?? null;
  const retrieval = await retrieveKnowledge({
    message,
    history,
    employeeId: employee.id,
    department: employee.department,
    location,
    safetyIdentifier: createHash("sha256").update(employee.id).digest("hex"),
  });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://tools.rftransparent.ca").replace(/\/+$/, "");

  return NextResponse.json({
    contractVersion: 2,
    initialPrompt,
    employee: {
      id: employee.id,
      name: employee.name,
      department: employee.department,
      location,
    },
    survey: survey
      ? {
          weekOf: survey.week_of,
          completed: survey.responded_at !== null,
          link: survey.responded_at ? null : `${appUrl}/survey/${survey.token}`,
        }
      : null,
    ...retrievalResponse(retrieval),
  }, { headers: { "Cache-Control": "no-store" } });
}

async function retrieveKnowledge({
  message,
  history,
  employeeId,
  department,
  location,
  safetyIdentifier,
}: {
  message: string;
  history: AssistantConversationMessage[];
  employeeId: string | null;
  department: string | null;
  location: string | null;
  safetyIdentifier: string;
}): Promise<{ query: string; knowledge: AssistantKnowledgeMatch[]; mode: "hybrid" | "compatibility" | "smalltalk" }> {
  if (!message) {
    try {
      return {
        query: "",
        mode: "compatibility",
        knowledge: await listAssistantKnowledgeForContext({ department, location }),
      };
    } catch (error) {
      console.error(
        "[whatsapp-assistant] Compatibility knowledge load failed:",
        error instanceof Error ? error.message : error,
      );
      return { query: "", mode: "compatibility", knowledge: [] };
    }
  }
  // Greetings and acknowledgements are conversation, not knowledge questions:
  // no search, and no gap-log entry that would clutter the Gaps tab.
  if (isSmalltalkMessage(message)) {
    return { query: "", mode: "smalltalk", knowledge: [] };
  }
  const query = await rewriteAssistantRetrievalQuery({ message, history, safetyIdentifier });
  let knowledge: AssistantKnowledgeMatch[] = [];
  try {
    knowledge = await searchAssistantKnowledge(query, { department, location });
  } catch (error) {
    console.error(
      "[whatsapp-assistant] Knowledge search failed:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    await recordAssistantKnowledgeQuery({
      employeeId,
      message,
      rewrittenQuery: query,
      department,
      location,
      matches: knowledge,
    });
  } catch (error) {
    console.error(
      "[whatsapp-assistant] Knowledge query logging failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return { query, mode: "hybrid" as const, knowledge };
}

function retrievalResponse(retrieval: {
  query: string;
  knowledge: AssistantKnowledgeMatch[];
  mode: "hybrid" | "compatibility" | "smalltalk";
}) {
  return {
    knowledge: retrieval.knowledge,
    knowledgeContext: formatAssistantKnowledgeContext(retrieval.knowledge),
    retrieval: {
      query: retrieval.query,
      mode: retrieval.mode,
      matched: retrieval.knowledge.length > 0,
      citations: retrieval.knowledge.map((entry) => ({
        knowledgeId: entry.id,
        title: entry.title,
        sourceId: entry.source_id,
        sourceTitle: entry.source_title,
      })),
    },
  };
}

function normalizeConversationHistory(value: unknown): AssistantConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = "role" in item ? item.role : null;
    const content = "content" in item ? item.content : null;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    const normalized = content.trim().slice(0, 2000);
    return normalized ? [{ role, content: normalized }] : [];
  });
}
