import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import {
  assistantKnowledgeDraftRequestSchema,
  generateAssistantKnowledgeDraft,
} from "@/lib/assistant-knowledge-draft";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = assistantKnowledgeDraftRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid source" },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const [employeeResult, locationResult] = await Promise.all([
    supabase.from("employees").select("department").not("department", "is", null),
    supabase.from("locations").select("name").order("name"),
  ]);
  const departments = [...new Set(
    (employeeResult.data ?? [])
      .map((item) => item.department as string | null)
      .filter((value): value is string => Boolean(value)),
  )].sort((left, right) => left.localeCompare(right));
  const locations = [...new Set(
    (locationResult.data ?? [])
      .map((item) => item.name as string | null)
      .filter((value): value is string => Boolean(value)),
  )];

  try {
    const result = await generateAssistantKnowledgeDraft({
      source: parsed.data.source,
      departments,
      locations,
      safetyIdentifier: createHash("sha256")
        .update(user.email ?? user.id)
        .digest("hex"),
    });
    if (!result.publishable) {
      return NextResponse.json(
        { error: result.reviewNote, model: result.model },
        { status: 422 },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create knowledge draft" },
      { status: 502 },
    );
  }
}
