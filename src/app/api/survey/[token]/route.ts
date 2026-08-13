import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  validateSurveyAnswers,
  type SurveyPrivacyModel,
  type SurveyQuestionSnapshot,
  type SurveyType,
} from "@/lib/survey-program";

export const dynamic = "force-dynamic";

interface CampaignPublicRow {
  id: string;
  name: string;
  purpose: string;
  survey_type: SurveyType;
  privacy_model: SurveyPrivacyModel;
  status: string;
  question_snapshot: SurveyQuestionSnapshot[];
  closes_at: string | null;
  retention_days: number;
  min_group_size: number;
}

interface RecipientPublicRow {
  id: string;
  employee_name: string;
  opened_at: string | null;
  completed_at: string | null;
  survey_campaigns: CampaignPublicRow | CampaignPublicRow[] | null;
}

function campaignFrom(row: RecipientPublicRow): CampaignPublicRow | null {
  return Array.isArray(row.survey_campaigns)
    ? row.survey_campaigns[0] ?? null
    : row.survey_campaigns;
}

async function loadSurvey(token: string): Promise<{ recipient: RecipientPublicRow; campaign: CampaignPublicRow } | null> {
  const { data, error } = await getSupabase()
    .from("survey_recipients")
    .select("id,employee_name,opened_at,completed_at,survey_campaigns!inner(id,name,purpose,survey_type,privacy_model,status,question_snapshot,closes_at,retention_days,min_group_size)")
    .eq("token", token)
    .single();
  if (error || !data) return null;
  const recipient = data as unknown as RecipientPublicRow;
  const campaign = campaignFrom(recipient);
  return campaign ? { recipient, campaign } : null;
}

function privacyNotice(campaign: CampaignPublicRow): string[] {
  const retention = `Written answers are retained for ${campaign.retention_days} days, then removed.`;
  const purpose = `This survey is collected to ${campaign.purpose.charAt(0).toLowerCase()}${campaign.purpose.slice(1)}`;
  const notPerformance = "Survey answers are not used for commissions, performance scores, discipline, or compensation.";
  if (campaign.privacy_model === "confidential_aggregate") {
    return [
      purpose,
      "Your completion is tracked separately from your answers. Submitted answers are stored without your employee identity.",
      `Management sees only confidential aggregate results, and department or location results are hidden until at least ${campaign.min_group_size} people respond.`,
      retention,
      notPerformance,
    ];
  }
  if (campaign.privacy_model === "restricted_named") {
    return [
      purpose,
      "Your answers are named and visible only to the small management group responsible for this survey.",
      "These answers do not appear in the regular weekly survey dashboard.",
      retention,
      notPerformance,
    ];
  }
  return [
    purpose,
    "Your answers are named so management can provide individual support when needed. Only management can view survey results.",
    retention,
    notPerformance,
  ];
}

function isClosed(campaign: CampaignPublicRow): boolean {
  return campaign.status !== "open"
    || Boolean(campaign.closes_at && new Date(campaign.closes_at).getTime() <= Date.now());
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const loaded = await loadSurvey(token);
  if (!loaded) return NextResponse.json({ error: "Survey not found" }, { status: 404 });

  const { recipient, campaign } = loaded;
  if (!recipient.opened_at && !recipient.completed_at) {
    const timestamp = new Date().toISOString();
    await getSupabase()
      .from("survey_recipients")
      .update({ opened_at: timestamp, delivery_status: "opened", updated_at: timestamp })
      .eq("id", recipient.id)
      .is("opened_at", null);
  }

  return NextResponse.json({
    employee_name: recipient.employee_name,
    title: campaign.name,
    purpose: campaign.purpose,
    survey_type: campaign.survey_type,
    privacy_model: campaign.privacy_model,
    questions: campaign.question_snapshot,
    closes_at: campaign.closes_at,
    already_responded: recipient.completed_at !== null,
    closed: isClosed(campaign),
    privacy_notice: privacyNotice(campaign),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const loaded = await loadSurvey(token);
  if (!loaded) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  if (loaded.recipient.completed_at) {
    return NextResponse.json({ error: "Already responded" }, { status: 409 });
  }
  if (isClosed(loaded.campaign)) {
    return NextResponse.json({ error: "This survey is closed" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let answers;
  try {
    answers = validateSurveyAnswers(
      loaded.campaign.question_snapshot,
      body && typeof body === "object" && "answers" in body ? body.answers : null,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid answers" },
      { status: 400 },
    );
  }

  const { data, error } = await getSupabase().rpc("submit_employee_survey", {
    p_token: token,
    p_answers: answers,
  });
  if (error) {
    const message = error.message ?? "Survey submission failed";
    if (message.includes("already_responded")) {
      return NextResponse.json({ error: "Already responded" }, { status: 409 });
    }
    if (message.includes("survey_closed")) {
      return NextResponse.json({ error: "This survey is closed" }, { status: 410 });
    }
    console.error("[survey] submission failed", error);
    return NextResponse.json({ error: "Survey submission failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
}
