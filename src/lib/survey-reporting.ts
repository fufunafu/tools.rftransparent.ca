import "server-only";
import { getSupabase } from "@/lib/supabase";
import {
  aggregateMetric,
  materiallyBelowBaseline,
  recurringFeedbackThemes,
  responseRateDropped,
  shouldExposeGroup,
  type MetricAggregate,
  type SurveyPrivacyModel,
  type SurveyQuestionSnapshot,
  type SurveyType,
} from "@/lib/survey-program";

interface CampaignRow {
  id: string;
  name: string;
  survey_type: SurveyType;
  privacy_model: SurveyPrivacyModel;
  status: string;
  send_at: string | null;
  closes_at: string | null;
  min_group_size: number;
  question_snapshot: SurveyQuestionSnapshot[];
}

interface RecipientRow {
  id: string;
  campaign_id: string;
  employee_id: string | null;
  employee_name: string;
  department_snapshot: string | null;
  location_name_snapshot: string | null;
  delivery_status: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  completed_at: string | null;
}

interface ResponseRow {
  id: string;
  campaign_id: string;
  recipient_id: string | null;
  employee_id: string | null;
  department_snapshot: string | null;
  location_name_snapshot: string | null;
  identity_mode: SurveyPrivacyModel;
  submitted_at: string;
}

interface AnswerRow {
  response_id: string;
  metric_key: string;
  question_text_snapshot: string;
  response_type: string;
  numeric_value: number | null;
  text_value: string | null;
  boolean_value: boolean | null;
  choice_value: string | null;
}

interface ActionRow {
  id: string;
  campaign_id: string | null;
  response_id: string | null;
  employee_id: string | null;
  kind: "private_review" | "team_action" | "employee_update";
  title: string;
  issue: string | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  due_at: string | null;
  status: "open" | "acknowledged" | "in_progress" | "completed" | "cancelled";
  acknowledged_at: string | null;
  completed_at: string | null;
  resolution: string | null;
  published_at: string | null;
  private: boolean;
  created_at: string;
}

export interface SurveyCampaignReport {
  id: string;
  name: string;
  type: SurveyType;
  privacyModel: SurveyPrivacyModel;
  status: string;
  sentAt: string | null;
  closesAt: string | null;
  delivery: {
    audience: number;
    sent: number;
    delivered: number;
    opened: number;
    completed: number;
    deliveryRate: number | null;
    responseRate: number | null;
  };
  overallSuppressed: boolean;
  metrics: Array<{
    metricKey: string;
    prompt: string;
    aggregate: MetricAggregate;
  }>;
  groups: Array<{
    kind: "department" | "location";
    label: string;
    responseCount: number;
    suppressed: boolean;
    metrics: Array<{ metricKey: string; aggregate: MetricAggregate }> | null;
  }>;
  responses: Array<{
    responseId: string;
    employeeId: string | null;
    employeeName: string | null;
    submittedAt: string;
    answers: AnswerRow[];
  }> | null;
}

export interface SurveyDashboardReport {
  campaigns: SurveyCampaignReport[];
  restrictedCampaigns: SurveyCampaignReport[];
  fourWeekTrend: Array<{
    campaignId: string;
    name: string;
    sentAt: string | null;
    median: number | null;
    responseRate: number | null;
  }>;
  themes: Array<{ theme: string; mentions: number }>;
  requestedFollowUps: number;
  actions: ActionRow[];
  actionMetrics: {
    open: number;
    overdue: number;
    completed: number;
    averageCompletionHours: number | null;
    followUpRequests: number;
    acknowledgedOnTime: number;
    acknowledgementRate: number | null;
    lastEmployeeUpdateAt: string | null;
    employeeUpdateDue: boolean;
  };
  alerts: Array<{ kind: string; message: string; campaignId?: string; actionId?: string }>;
}

function roundPercent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function valuesForMetric(answerRows: AnswerRow[], responseIds: Set<string>, metricKey: string): number[] {
  return answerRows
    .filter((answer) => responseIds.has(answer.response_id) && answer.metric_key === metricKey && answer.numeric_value !== null)
    .map((answer) => Number(answer.numeric_value));
}

function exposedResponses(
  campaign: CampaignRow,
  responses: ResponseRow[],
  recipients: RecipientRow[],
  answers: AnswerRow[],
  canViewRestricted: boolean,
): SurveyCampaignReport["responses"] {
  if (campaign.privacy_model === "confidential_aggregate") return null;
  if (campaign.privacy_model === "restricted_named" && !canViewRestricted) return null;
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  return responses.map((response) => ({
    responseId: response.id,
    employeeId: response.employee_id,
    employeeName: response.recipient_id
      ? recipientById.get(response.recipient_id)?.employee_name ?? null
      : null,
    submittedAt: response.submitted_at,
    answers: answers.filter((answer) => answer.response_id === response.id),
  }));
}

function groupReports(
  campaign: CampaignRow,
  responses: ResponseRow[],
  answers: AnswerRow[],
): SurveyCampaignReport["groups"] {
  const result: SurveyCampaignReport["groups"] = [];
  for (const kind of ["department", "location"] as const) {
    const groups = new Map<string, ResponseRow[]>();
    for (const response of responses) {
      const label = kind === "department" ? response.department_snapshot : response.location_name_snapshot;
      if (!label) continue;
      const rows = groups.get(label) ?? [];
      rows.push(response);
      groups.set(label, rows);
    }
    for (const [label, rows] of groups) {
      const minimum = Math.max(5, campaign.min_group_size);
      const exposed = shouldExposeGroup(rows.length, minimum);
      const ids = new Set(rows.map((response) => response.id));
      result.push({
        kind,
        label,
        responseCount: rows.length,
        suppressed: !exposed,
        metrics: exposed
          ? campaign.question_snapshot
            .filter((question) => question.response_type === "scale")
            .map((question) => ({
              metricKey: question.metric_key,
              aggregate: aggregateMetric(valuesForMetric(answers, ids, question.metric_key)),
            }))
          : null,
      });
    }
  }
  return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

export function buildSurveyDashboardReport(input: {
  campaigns: CampaignRow[];
  recipients: RecipientRow[];
  responses: ResponseRow[];
  answers: AnswerRow[];
  actions: ActionRow[];
  canViewRestricted: boolean;
  now?: Date;
}): SurveyDashboardReport {
  const now = input.now ?? new Date();
  const reports = input.campaigns.map((campaign): SurveyCampaignReport => {
    const recipients = input.recipients.filter((recipient) => recipient.campaign_id === campaign.id);
    const responses = input.responses.filter((response) => response.campaign_id === campaign.id);
    const responseIds = new Set(responses.map((response) => response.id));
    const answers = input.answers.filter((answer) => responseIds.has(answer.response_id));
    const sent = recipients.filter((recipient) => recipient.sent_at).length;
    const delivered = recipients.filter((recipient) => recipient.delivered_at || ["delivered", "opened", "completed"].includes(recipient.delivery_status)).length;
    const opened = recipients.filter((recipient) => recipient.opened_at).length;
    const completed = recipients.filter((recipient) => recipient.completed_at).length;
    const overallSuppressed = campaign.privacy_model === "confidential_aggregate"
      && responses.length < Math.max(5, campaign.min_group_size);
    return {
      id: campaign.id,
      name: campaign.name,
      type: campaign.survey_type,
      privacyModel: campaign.privacy_model,
      status: campaign.status,
      sentAt: campaign.send_at,
      closesAt: campaign.closes_at,
      delivery: {
        audience: recipients.length,
        sent,
        delivered,
        opened,
        completed,
        deliveryRate: roundPercent(delivered, sent),
        responseRate: roundPercent(completed, recipients.length),
      },
      overallSuppressed,
      metrics: overallSuppressed ? [] : campaign.question_snapshot
        .filter((question) => question.response_type === "scale")
        .map((question) => ({
          metricKey: question.metric_key,
          prompt: question.prompt,
          aggregate: aggregateMetric(valuesForMetric(answers, responseIds, question.metric_key)),
        })),
      groups: groupReports(campaign, responses, answers),
      responses: exposedResponses(campaign, responses, recipients, answers, input.canViewRestricted),
    };
  });

  const regularReports = reports.filter((report) => report.type !== "exit");
  const restrictedCampaigns = reports.filter((report) => report.type === "exit");
  const regularCampaignIds = new Set(
    regularReports
      .filter((report) => !report.overallSuppressed)
      .map((report) => report.id),
  );
  const regularResponseIds = new Set(input.responses.filter((response) => regularCampaignIds.has(response.campaign_id)).map((response) => response.id));
  const trend = regularReports
    .filter((report) => report.type === "weekly")
    .sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""))
    .slice(-4)
    .map((report) => ({
      campaignId: report.id,
      name: report.name,
      sentAt: report.sentAt,
      median: report.metrics.find((metric) => metric.metricKey === "weekly_overall")?.aggregate.median ?? null,
      responseRate: report.delivery.responseRate,
    }));

  const textComments = input.answers
    .filter((answer) => regularResponseIds.has(answer.response_id))
    .filter((answer) => answer.response_type === "text" && answer.text_value)
    .map((answer) => answer.text_value!);
  const followUpAnswers = input.answers.filter((answer) => regularResponseIds.has(answer.response_id) && answer.metric_key === "manager_follow_up" && answer.boolean_value === true);
  const completedActions = input.actions.filter((action) => action.status === "completed" && action.completed_at);
  const followUpActions = input.actions.filter((action) => action.kind === "private_review");
  const acknowledgedOnTime = followUpActions.filter((action) =>
    Boolean(action.acknowledged_at && action.due_at && new Date(action.acknowledged_at) <= new Date(action.due_at)),
  ).length;
  const averageCompletionHours = completedActions.length > 0
    ? Math.round(
      (completedActions.reduce((sum, action) => sum + (new Date(action.completed_at!).getTime() - new Date(action.created_at).getTime()) / 3_600_000, 0)
        / completedActions.length) * 10,
    ) / 10
    : null;
  const lastEmployeeUpdateAt = input.actions
    .filter((action) => action.kind === "employee_update" && action.published_at)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0]?.published_at ?? null;

  const alerts: SurveyDashboardReport["alerts"] = [];
  const weeklyReports = regularReports
    .filter((report) => report.type === "weekly")
    .sort((a, b) => (a.sentAt ?? "").localeCompare(b.sentAt ?? ""));
  const latest = weeklyReports.at(-1);
  const earlier = weeklyReports.slice(-5, -1);
  if (latest && earlier.length > 0) {
    const historicalScores = earlier.flatMap((report) => {
      const metric = report.metrics.find((item) => item.metricKey === "weekly_overall");
      if (!metric?.aggregate.average) return [];
      return [metric.aggregate.average];
    });
    const scoreBaseline = historicalScores.length > 0
      ? historicalScores.reduce((sum, score) => sum + score, 0) / historicalScores.length
      : null;
    const currentScore = latest.metrics.find((metric) => metric.metricKey === "weekly_overall")?.aggregate.average ?? null;
    if (materiallyBelowBaseline(currentScore, scoreBaseline)) {
      alerts.push({ kind: "team_score_drop", campaignId: latest.id, message: "The latest weekly score is materially below its four-week baseline." });
    }
    const rates = earlier.flatMap((report) => report.delivery.responseRate === null ? [] : [report.delivery.responseRate]);
    const rateBaseline = rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
    if (responseRateDropped(latest.delivery.responseRate, rateBaseline)) {
      alerts.push({ kind: "response_rate_drop", campaignId: latest.id, message: "The latest response rate dropped by at least 20 percentage points." });
    }
  }
  for (const action of input.actions) {
    if (action.status !== "completed" && action.status !== "cancelled" && action.due_at && new Date(action.due_at) < now) {
      alerts.push({ kind: "overdue_action", actionId: action.id, message: `Management action overdue: ${action.title}` });
    }
  }

  return {
    campaigns: regularReports.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")),
    restrictedCampaigns: restrictedCampaigns.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")),
    fourWeekTrend: trend,
    themes: recurringFeedbackThemes(textComments),
    requestedFollowUps: followUpAnswers.length,
    actions: input.actions,
    actionMetrics: {
      open: input.actions.filter((action) => !["completed", "cancelled"].includes(action.status)).length,
      overdue: input.actions.filter((action) => !["completed", "cancelled"].includes(action.status) && action.due_at && new Date(action.due_at) < now).length,
      completed: completedActions.length,
      averageCompletionHours,
      followUpRequests: followUpActions.length,
      acknowledgedOnTime,
      acknowledgementRate: roundPercent(acknowledgedOnTime, followUpActions.length),
      lastEmployeeUpdateAt,
      employeeUpdateDue: !lastEmployeeUpdateAt
        || now.getTime() - new Date(lastEmployeeUpdateAt).getTime() > 35 * 86_400_000,
    },
    alerts,
  };
}

export async function loadSurveyDashboardReport(canViewRestricted: boolean): Promise<SurveyDashboardReport> {
  const supabase = getSupabase();
  let campaignQuery = supabase
    .from("survey_campaigns")
    .select("id,name,survey_type,privacy_model,status,send_at,closes_at,min_group_size,question_snapshot")
    .order("send_at", { ascending: false })
    .limit(40);
  if (!canViewRestricted) campaignQuery = campaignQuery.neq("privacy_model", "restricted_named");
  const campaignResult = await campaignQuery;
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  const campaigns = (campaignResult.data ?? []) as CampaignRow[];
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
  const ids = [...campaignIds];
  let actionQuery = supabase
    .from("survey_actions")
    .select("id,campaign_id,response_id,employee_id,kind,title,issue,owner_employee_id,owner_name,due_at,status,acknowledged_at,completed_at,resolution,published_at,private,created_at")
    .order("created_at", { ascending: false });
  actionQuery = ids.length > 0
    ? actionQuery.or(`campaign_id.is.null,campaign_id.in.(${ids.join(",")})`)
    : actionQuery.is("campaign_id", null);
  const [recipientResult, responseResult, actionResult] = await Promise.all([
    ids.length > 0
      ? supabase.from("survey_recipients").select("id,campaign_id,employee_id,employee_name,department_snapshot,location_name_snapshot,delivery_status,sent_at,delivered_at,opened_at,completed_at").in("campaign_id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length > 0
      ? supabase.from("survey_responses").select("id,campaign_id,recipient_id,employee_id,department_snapshot,location_name_snapshot,identity_mode,submitted_at").in("campaign_id", ids)
      : Promise.resolve({ data: [], error: null }),
    actionQuery,
  ]);
  const failure = [recipientResult, responseResult, actionResult].find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);
  const recipients = (recipientResult.data ?? []) as RecipientRow[];
  const responses = (responseResult.data ?? []) as ResponseRow[];
  const responseIds = new Set(responses.map((response) => response.id));
  const answerIds = [...responseIds];
  const answerResult = answerIds.length > 0
    ? await supabase.from("survey_answers").select("response_id,metric_key,question_text_snapshot,response_type,numeric_value,text_value,boolean_value,choice_value").in("response_id", answerIds)
    : { data: [], error: null };
  if (answerResult.error) throw new Error(answerResult.error.message);
  const answers = (answerResult.data ?? []) as AnswerRow[];
  const actions = ((actionResult.data ?? []) as ActionRow[]).filter((action) => !action.campaign_id || campaignIds.has(action.campaign_id));
  return buildSurveyDashboardReport({ campaigns, recipients, responses, answers, actions, canViewRestricted });
}
