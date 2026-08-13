import { getSupabase } from "@/lib/supabase";
import {
  assertWhatsAppConfigured,
  normalizeWhatsAppNumber,
  sendWhatsAppSurvey,
} from "@/lib/whatsapp";
import {
  getSurveyAutomationTasks,
  isFirstThursdayOfQuarter,
  surveyWindowForThursday,
  torontoDateKey,
  torontoDateTimeToUtc,
  type SurveyPrivacyModel,
  type SurveyQuestionSnapshot,
  type SurveyType,
} from "@/lib/survey-program";

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  survey_type: SurveyType;
  purpose: string;
  privacy_model: SurveyPrivacyModel;
  estimated_minutes: number;
  retention_days: number;
  min_group_size: number;
}

interface QuestionRow extends SurveyQuestionSnapshot {
  template_id: string;
  active: boolean;
}

export interface SurveyEmployeeTarget {
  id: string;
  name: string;
  department: string | null;
  location_id: string | null;
  phone: string | null;
  email: string | null;
  hire_date?: string | null;
  employment_ended_at?: string | null;
  exit_survey_enabled?: boolean;
  active?: boolean;
  locations?: { name: string } | { name: string }[] | null;
}

interface CampaignRow {
  id: string;
  template_slug: string;
  survey_type: SurveyType;
  name: string;
  purpose: string;
  privacy_model: SurveyPrivacyModel;
  status: string;
  question_snapshot: SurveyQuestionSnapshot[];
  send_at: string | null;
  closes_at: string | null;
  reminder_at: string | null;
}

interface RecipientRow {
  id: string;
  campaign_id: string;
  employee_id: string | null;
  token: string;
  employee_name: string;
  phone_snapshot: string | null;
  delivery_status: string;
  sent_at: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
}

interface CampaignSchedule {
  sendAt: Date;
  opensAt: Date;
  reminderAt: Date | null;
  closesAt: Date;
}

interface CampaignAudience {
  kind: "all_active" | "department" | "location" | "employee_ids" | "lifecycle" | "departing";
  department?: string;
  locationId?: string;
  employeeIds?: string[];
  lifecycleDay?: 14 | 45 | 90;
}

export interface CampaignDeliveryResult {
  campaignId: string;
  campaignType: SurveyType;
  campaignName: string;
  created: boolean;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface SurveyAutomationResult {
  campaigns: CampaignDeliveryResult[];
  reminders: { sent: number; failed: number; errors: string[] };
  closed: number;
  writtenAnswersPurged: number;
  status: "success" | "skipped";
}

interface CreateCampaignOptions {
  templateSlug: string;
  dedupeKey: string;
  schedule: CampaignSchedule;
  audience: CampaignAudience;
  targets: SurveyEmployeeTarget[];
  name?: string;
  purpose?: string;
  decisionSupported?: string | null;
  createdBy?: string | null;
}

function locationName(employee: SurveyEmployeeTarget): string | null {
  if (Array.isArray(employee.locations)) return employee.locations[0]?.name ?? null;
  return employee.locations?.name ?? null;
}

function templateQuestionSnapshot(questions: QuestionRow[]): SurveyQuestionSnapshot[] {
  return questions
    .filter((question) => question.active)
    .sort((a, b) => a.display_order - b.display_order)
    .map((question) => ({
      id: question.id,
      metric_key: question.metric_key,
      prompt: question.prompt,
      response_type: question.response_type,
      options: question.options,
      dimension: question.dimension,
      required: question.required,
      display_order: question.display_order,
    }));
}

async function loadTemplate(slug: string): Promise<{ template: TemplateRow; questions: QuestionRow[] }> {
  const supabase = getSupabase();
  const { data: template, error: templateError } = await supabase
    .from("survey_templates")
    .select("id,slug,name,survey_type,purpose,privacy_model,estimated_minutes,retention_days,min_group_size")
    .eq("slug", slug)
    .eq("active", true)
    .single();
  if (templateError || !template) {
    throw new Error(templateError?.message ?? `Survey template not found: ${slug}`);
  }

  const { data: questions, error: questionError } = await supabase
    .from("survey_questions")
    .select("id,template_id,metric_key,prompt,response_type,options,dimension,required,display_order,active")
    .eq("template_id", template.id)
    .eq("active", true)
    .order("display_order");
  if (questionError) throw new Error(questionError.message);
  if (!questions?.length) throw new Error(`Survey template has no active questions: ${slug}`);

  return {
    template: template as TemplateRow,
    questions: questions as QuestionRow[],
  };
}

async function findCampaignByDedupeKey(dedupeKey: string): Promise<CampaignRow | null> {
  const { data, error } = await getSupabase()
    .from("survey_campaigns")
    .select("id,template_slug,survey_type,name,purpose,privacy_model,status,question_snapshot,send_at,closes_at,reminder_at")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CampaignRow | null;
}

async function ensureCampaign(options: CreateCampaignOptions): Promise<{ campaign: CampaignRow; created: boolean }> {
  const existing = await findCampaignByDedupeKey(options.dedupeKey);
  if (existing) return { campaign: existing, created: false };

  const { template, questions } = await loadTemplate(options.templateSlug);
  const snapshot = templateQuestionSnapshot(questions);
  const { data, error } = await getSupabase()
    .from("survey_campaigns")
    .insert({
      template_id: template.id,
      template_slug: template.slug,
      survey_type: template.survey_type,
      name: options.name?.trim() || template.name,
      purpose: options.purpose?.trim() || template.purpose,
      privacy_model: template.privacy_model,
      status: "open",
      audience: options.audience,
      question_snapshot: snapshot,
      send_at: options.schedule.sendAt.toISOString(),
      opens_at: options.schedule.opensAt.toISOString(),
      closes_at: options.schedule.closesAt.toISOString(),
      reminder_at: options.schedule.reminderAt?.toISOString() ?? null,
      retention_days: template.retention_days,
      min_group_size: template.min_group_size,
      dedupe_key: options.dedupeKey,
      decision_supported: options.decisionSupported?.trim() || null,
      created_by: options.createdBy?.trim() || null,
    })
    .select("id,template_slug,survey_type,name,purpose,privacy_model,status,question_snapshot,send_at,closes_at,reminder_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      const raced = await findCampaignByDedupeKey(options.dedupeKey);
      if (raced) return { campaign: raced, created: false };
    }
    throw new Error(error.message);
  }
  return { campaign: data as CampaignRow, created: true };
}

async function ensureRecipients(campaignId: string, targets: SurveyEmployeeTarget[]): Promise<RecipientRow[]> {
  const supabase = getSupabase();
  if (targets.length > 0) {
    const rows = targets.map((employee) => ({
      campaign_id: campaignId,
      employee_id: employee.id,
      token: crypto.randomUUID(),
      employee_name: employee.name,
      department_snapshot: employee.department,
      location_id_snapshot: employee.location_id,
      location_name_snapshot: locationName(employee),
      phone_snapshot: employee.phone,
      email_snapshot: employee.email,
    }));
    const { error } = await supabase
      .from("survey_recipients")
      .upsert(rows, { onConflict: "campaign_id,employee_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from("survey_recipients")
    .select("id,campaign_id,employee_id,token,employee_name,phone_snapshot,delivery_status,sent_at,reminder_sent_at,completed_at")
    .eq("campaign_id", campaignId)
    .order("employee_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as RecipientRow[];
}

function testMode() {
  const recipient = process.env.WHATSAPP_TEST_RECIPIENT?.trim() || null;
  const employeeId = process.env.WHATSAPP_TEST_EMPLOYEE_ID?.trim() || null;
  if (Boolean(recipient) !== Boolean(employeeId)) {
    throw new Error("WHATSAPP_TEST_RECIPIENT and WHATSAPP_TEST_EMPLOYEE_ID must be configured together");
  }
  return { recipient, employeeId };
}

function appUrl(): string {
  const value = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!value) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return value;
}

async function deliverCampaign(campaign: CampaignRow, recipients: RecipientRow[]): Promise<Omit<CampaignDeliveryResult, "created">> {
  assertWhatsAppConfigured();
  const baseUrl = appUrl();
  const test = testMode();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    if (recipient.sent_at || recipient.completed_at) {
      skipped += 1;
      continue;
    }
    if (test.employeeId && recipient.employee_id !== test.employeeId) {
      skipped += 1;
      continue;
    }

    let destination: string;
    try {
      destination = `+${normalizeWhatsAppNumber(test.recipient ?? recipient.phone_snapshot ?? "")}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Invalid WhatsApp phone number";
      await getSupabase()
        .from("survey_recipients")
        .update({ delivery_status: "failed", delivery_error: detail, updated_at: new Date().toISOString() })
        .eq("id", recipient.id);
      errors.push(`${recipient.employee_name} (invalid WhatsApp phone): ${detail}`);
      failed += 1;
      continue;
    }

    try {
      const result = await sendWhatsAppSurvey({
        to: destination,
        employeeName: recipient.employee_name,
        surveyUrl: `${baseUrl}/survey/${recipient.token}`,
      });
      const timestamp = new Date().toISOString();
      const { error } = await getSupabase()
        .from("survey_recipients")
        .update({
          delivery_status: "sent",
          provider_message_id: result.messageId,
          delivery_error: null,
          sent_at: timestamp,
          updated_at: timestamp,
        })
        .eq("id", recipient.id);
      if (error) throw new Error(error.message);
      sent += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await getSupabase()
        .from("survey_recipients")
        .update({ delivery_status: "failed", delivery_error: detail, updated_at: new Date().toISOString() })
        .eq("id", recipient.id);
      errors.push(`${recipient.employee_name} (WhatsApp send failed): ${detail}`);
      failed += 1;
    }
  }

  return {
    campaignId: campaign.id,
    campaignType: campaign.survey_type,
    campaignName: campaign.name,
    sent,
    skipped,
    failed,
    errors,
  };
}

export async function createAndSendSurveyCampaign(options: CreateCampaignOptions): Promise<CampaignDeliveryResult> {
  const { campaign, created } = await ensureCampaign(options);
  if (campaign.status !== "open" || (campaign.closes_at && new Date(campaign.closes_at) <= new Date())) {
    throw new Error("This survey campaign is already closed");
  }
  const test = testMode();
  const targets = test.employeeId
    ? options.targets.filter((employee) => employee.id === test.employeeId)
    : options.targets;
  const recipients = await ensureRecipients(campaign.id, targets);
  const delivery = await deliverCampaign(campaign, recipients);
  return { ...delivery, created };
}

async function activeEmployees(): Promise<SurveyEmployeeTarget[]> {
  const { data, error } = await getSupabase()
    .from("employees")
    .select("id,name,department,location_id,phone,email,hire_date,employment_ended_at,exit_survey_enabled,locations(name)")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SurveyEmployeeTarget[];
}

function localDateParts(date: Date) {
  const key = torontoDateKey(date);
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day, key };
}

function addLocalDays(date: Date, days: number, hour: number): Date {
  const parts = localDateParts(date);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return torontoDateTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    hour,
  );
}

function daysBetweenDateKeys(earlier: string, later: string): number {
  const start = new Date(`${earlier}T12:00:00Z`).getTime();
  const end = new Date(`${later}T12:00:00Z`).getTime();
  return Math.floor((end - start) / 86_400_000);
}

async function sendPeriodicCampaign(now: Date): Promise<CampaignDeliveryResult> {
  const targets = await activeEmployees();
  const window = surveyWindowForThursday(now);
  const quarterly = isFirstThursdayOfQuarter(now);
  const templateSlug = quarterly ? "quarterly-engagement" : "weekly-pulse";
  const dateKey = torontoDateKey(now);
  return createAndSendSurveyCampaign({
    templateSlug,
    dedupeKey: `${templateSlug}:${dateKey}`,
    schedule: {
      sendAt: window.sendAt,
      opensAt: window.opensAt,
      reminderAt: window.reminderAt,
      closesAt: window.closesAt,
    },
    audience: { kind: "all_active" },
    targets,
    name: quarterly ? `Quarterly engagement: ${dateKey}` : `Weekly pulse: ${dateKey}`,
  });
}

async function sendCurrentSurveyCampaign(now: Date): Promise<CampaignDeliveryResult> {
  const today = localDateParts(now);
  const targets = await activeEmployees();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short" }).format(now);
  const sinceThursday = ({ Thu: 0, Fri: 1, Sat: 2, Sun: 3, Mon: 4, Tue: 5, Wed: 6 } as Record<string, number>)[weekday] ?? 6;
  const anchor = addLocalDays(now, -sinceThursday, 15);
  const inCurrentResponseWindow = sinceThursday <= 5;
  const quarterly = inCurrentResponseWindow && isFirstThursdayOfQuarter(anchor);
  const templateSlug = quarterly ? "quarterly-engagement" : "weekly-pulse";
  const campaignDate = inCurrentResponseWindow ? torontoDateKey(anchor) : today.key;
  const dedupeKey = inCurrentResponseWindow
    ? `${templateSlug}:${campaignDate}`
    : `${templateSlug}:manual:${today.key}`;
  return createAndSendSurveyCampaign({
    templateSlug,
    dedupeKey,
    schedule: {
      sendAt: now,
      opensAt: now,
      reminderAt: addLocalDays(now, 4, 9),
      closesAt: addLocalDays(now, 5, 9),
    },
    audience: { kind: "all_active" },
    targets,
    name: `${quarterly ? "Quarterly engagement" : "Weekly pulse"}: ${campaignDate}`,
  });
}

async function lifecycleEmployees(): Promise<SurveyEmployeeTarget[]> {
  const { data, error } = await getSupabase()
    .from("employees")
    .select("id,name,department,location_id,phone,email,active,hire_date,employment_ended_at,exit_survey_enabled,locations(name)")
    .or("hire_date.not.is.null,employment_ended_at.not.is.null")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SurveyEmployeeTarget[];
}

async function excludePreviouslyInvited(
  templateSlug: string,
  employees: SurveyEmployeeTarget[],
): Promise<SurveyEmployeeTarget[]> {
  if (employees.length === 0) return [];
  const { data: campaigns, error: campaignError } = await getSupabase()
    .from("survey_campaigns")
    .select("id")
    .eq("template_slug", templateSlug);
  if (campaignError) throw new Error(campaignError.message);
  const campaignIds = (campaigns ?? []).map((campaign) => campaign.id as string);
  if (campaignIds.length === 0) return employees;
  const { data: recipients, error: recipientError } = await getSupabase()
    .from("survey_recipients")
    .select("employee_id")
    .in("campaign_id", campaignIds);
  if (recipientError) throw new Error(recipientError.message);
  const invited = new Set((recipients ?? []).map((recipient) => recipient.employee_id));
  return employees.filter((employee) => !invited.has(employee.id));
}

async function sendLifecycleCampaigns(now: Date): Promise<CampaignDeliveryResult[]> {
  const today = torontoDateKey(now);
  const employees = await lifecycleEmployees();
  const results: CampaignDeliveryResult[] = [];
  const schedule: CampaignSchedule = {
    sendAt: now,
    opensAt: now,
    reminderAt: addLocalDays(now, 4, 9),
    closesAt: addLocalDays(now, 7, 9),
  };

  for (const day of [14, 45, 90] as const) {
    const nextDay = day === 14 ? 45 : day === 45 ? 90 : 121;
    let targets = employees.filter((employee) =>
      employee.active !== false
      &&
      Boolean(employee.hire_date)
      && !employee.employment_ended_at
      && daysBetweenDateKeys(employee.hire_date!, today) >= day
      && daysBetweenDateKeys(employee.hire_date!, today) < nextDay,
    );
    const templateSlug = `onboarding-day-${day}`;
    targets = await excludePreviouslyInvited(templateSlug, targets);
    if (targets.length === 0) continue;
    results.push(await createAndSendSurveyCampaign({
      templateSlug,
      dedupeKey: `${templateSlug}:${today}`,
      schedule,
      audience: { kind: "lifecycle", lifecycleDay: day },
      targets,
      name: `Onboarding day ${day}: ${today}`,
    }));
  }

  let exitTargets = employees.filter((employee) =>
    employee.exit_survey_enabled !== false
    && Boolean(employee.employment_ended_at)
    && employee.employment_ended_at! <= today
    && daysBetweenDateKeys(employee.employment_ended_at!, today) <= 30,
  );
  exitTargets = await excludePreviouslyInvited("exit", exitTargets);
  if (exitTargets.length > 0) {
    results.push(await createAndSendSurveyCampaign({
      templateSlug: "exit",
      dedupeKey: `exit:${today}`,
      schedule,
      audience: { kind: "departing", employeeIds: exitTargets.map((employee) => employee.id) },
      targets: exitTargets,
      name: `Voluntary exit survey: ${today}`,
    }));
  }

  return results;
}

async function sendDueReminders(now: Date): Promise<{ sent: number; failed: number; errors: string[] }> {
  const { data: campaigns, error } = await getSupabase()
    .from("survey_campaigns")
    .select("id,template_slug,survey_type,name,purpose,privacy_model,status,question_snapshot,send_at,closes_at,reminder_at")
    .eq("status", "open")
    .lte("reminder_at", now.toISOString())
    .gt("closes_at", now.toISOString());
  if (error) throw new Error(error.message);

  const test = testMode();
  const baseUrl = appUrl();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const campaign of (campaigns ?? []) as CampaignRow[]) {
    const { data: recipients, error: recipientError } = await getSupabase()
      .from("survey_recipients")
      .select("id,campaign_id,employee_id,token,employee_name,phone_snapshot,delivery_status,sent_at,reminder_sent_at,completed_at")
      .eq("campaign_id", campaign.id)
      .is("completed_at", null)
      .is("reminder_sent_at", null);
    if (recipientError) throw new Error(recipientError.message);

    for (const recipient of (recipients ?? []) as RecipientRow[]) {
      if (test.employeeId && recipient.employee_id !== test.employeeId) continue;
      try {
        const destination = `+${normalizeWhatsAppNumber(test.recipient ?? recipient.phone_snapshot ?? "")}`;
        const result = await sendWhatsAppSurvey({
          to: destination,
          employeeName: recipient.employee_name,
          surveyUrl: `${baseUrl}/survey/${recipient.token}`,
          templateName: process.env.WHATSAPP_SURVEY_REMINDER_TEMPLATE_NAME?.trim() || undefined,
        });
        const timestamp = new Date().toISOString();
        const { error: updateError } = await getSupabase()
          .from("survey_recipients")
          .update({ reminder_message_id: result.messageId, reminder_sent_at: timestamp, updated_at: timestamp })
          .eq("id", recipient.id);
        if (updateError) throw new Error(updateError.message);
        sent += 1;
      } catch (sendError) {
        const detail = sendError instanceof Error ? sendError.message : String(sendError);
        errors.push(`${recipient.employee_name}: ${detail}`);
        failed += 1;
      }
    }
  }
  return { sent, failed, errors };
}

async function closeExpiredCampaigns(now: Date): Promise<number> {
  const { data, error } = await getSupabase()
    .from("survey_campaigns")
    .update({ status: "closed", updated_at: now.toISOString() })
    .eq("status", "open")
    .lte("closes_at", now.toISOString())
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

async function purgeExpiredWrittenAnswers(now: Date): Promise<number> {
  const { data: campaigns, error } = await getSupabase()
    .from("survey_campaigns")
    .select("id,closes_at,retention_days")
    .not("closes_at", "is", null);
  if (error) throw new Error(error.message);

  const expiredCampaignIds = (campaigns ?? [])
    .filter((campaign) => {
      const expires = new Date(campaign.closes_at).getTime() + campaign.retention_days * 86_400_000;
      return expires <= now.getTime();
    })
    .map((campaign) => campaign.id as string);
  let purged = 0;
  for (let offset = 0; offset < expiredCampaignIds.length; offset += 100) {
    const campaignIds = expiredCampaignIds.slice(offset, offset + 100);
    const { data: responses, error: responseError } = await getSupabase()
      .from("survey_responses")
      .select("id")
      .in("campaign_id", campaignIds);
    if (responseError) throw new Error(responseError.message);
    const responseIds = (responses ?? []).map((response) => response.id as string);
    if (responseIds.length === 0) continue;
    const { data: answers, error: answerError } = await getSupabase()
      .from("survey_answers")
      .update({ text_value: null })
      .eq("response_type", "text")
      .not("text_value", "is", null)
      .in("response_id", responseIds)
      .select("id");
    if (answerError) throw new Error(answerError.message);
    purged += answers?.length ?? 0;
  }
  const legacyCutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const { data: legacyRows, error: legacyError } = await getSupabase()
    .from("employee_surveys")
    .update({ highlights: null, complaints: null, suggestions: null })
    .lt("responded_at", legacyCutoff)
    .or("highlights.not.is.null,complaints.not.is.null,suggestions.not.is.null")
    .select("id");
  if (legacyError) throw new Error(legacyError.message);
  purged += legacyRows?.length ?? 0;
  return purged;
}

export async function runSurveyAutomation(
  now = new Date(),
  options: { forcePeriodic?: boolean; forceMaintenance?: boolean } = {},
): Promise<SurveyAutomationResult> {
  const tasks = getSurveyAutomationTasks(now);
  const campaigns: CampaignDeliveryResult[] = [];
  let reminders = { sent: 0, failed: 0, errors: [] as string[] };
  let closed = 0;
  let writtenAnswersPurged = 0;

  if (tasks.sendPeriodicCampaign || options.forcePeriodic) {
    campaigns.push(options.forcePeriodic
      ? await sendCurrentSurveyCampaign(now)
      : await sendPeriodicCampaign(now));
  }
  if (tasks.sendLifecycleCampaigns || options.forceMaintenance) {
    campaigns.push(...await sendLifecycleCampaigns(now));
  }
  if (tasks.sendReminders || options.forceMaintenance) reminders = await sendDueReminders(now);
  if (tasks.closeExpiredCampaigns || options.forceMaintenance) closed = await closeExpiredCampaigns(now);
  if (tasks.purgeExpiredWrittenAnswers || options.forceMaintenance) {
    writtenAnswersPurged = await purgeExpiredWrittenAnswers(now);
  }

  const didWork = campaigns.length > 0 || reminders.sent > 0 || reminders.failed > 0 || closed > 0 || writtenAnswersPurged > 0;
  return {
    campaigns,
    reminders,
    closed,
    writtenAnswersPurged,
    status: didWork ? "success" : "skipped",
  };
}

/** Compatibility entry point used by the existing manual survey action. */
export async function sendSurveys(): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const periodic = await sendCurrentSurveyCampaign(new Date());
  return {
    sent: periodic.sent,
    skipped: periodic.skipped,
    errors: periodic.errors,
  };
}

export async function createTargetedSurveyCampaign(input: {
  name: string;
  purpose: string;
  decisionSupported: string;
  department?: string | null;
  locationId?: string | null;
  employeeIds?: string[];
  createdBy: string;
  sendAt?: Date;
}): Promise<CampaignDeliveryResult> {
  if (!input.name.trim()) throw new Error("Campaign name is required");
  if (!input.purpose.trim()) throw new Error("Describe the meaningful event being evaluated");
  if (!input.decisionSupported.trim()) {
    throw new Error("Identify the specific decision these answers will support");
  }

  let targets = await activeEmployees();
  if (input.department) targets = targets.filter((employee) => employee.department === input.department);
  if (input.locationId) targets = targets.filter((employee) => employee.location_id === input.locationId);
  if (input.employeeIds?.length) {
    const ids = new Set(input.employeeIds);
    targets = targets.filter((employee) => ids.has(employee.id));
  }
  if (targets.length === 0) throw new Error("The selected audience has no active employees");

  const sendAt = input.sendAt ?? new Date();
  return createAndSendSurveyCampaign({
    templateSlug: "targeted-change",
    dedupeKey: `targeted:${crypto.randomUUID()}`,
    schedule: {
      sendAt,
      opensAt: sendAt,
      reminderAt: new Date(sendAt.getTime() + 4 * 86_400_000),
      closesAt: new Date(sendAt.getTime() + 7 * 86_400_000),
    },
    audience: input.employeeIds?.length
      ? { kind: "employee_ids", employeeIds: input.employeeIds }
      : input.department
        ? { kind: "department", department: input.department }
        : input.locationId
          ? { kind: "location", locationId: input.locationId }
          : { kind: "all_active" },
    targets,
    name: input.name,
    purpose: input.purpose,
    decisionSupported: input.decisionSupported,
    createdBy: input.createdBy,
  });
}
