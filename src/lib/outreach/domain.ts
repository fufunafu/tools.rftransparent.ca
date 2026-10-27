import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { campaignKeys, type CampaignKey } from "./types";
export { campaignKeys, campaignNames, type CampaignKey } from "./types";

export interface OutreachConfig {
  workspaceId: string;
  campaignIds: Record<CampaignKey, string>;
  webhookSecret: string;
}

const uuid = z.string().uuid();
export function getOutreachConfig(env: Record<string, string | undefined> = process.env): OutreachConfig | null {
  const workspaceId = env.OUTREACH_INSTANTLY_WORKSPACE_ID ?? "";
  const installer = env.OUTREACH_INSTALLER_CAMPAIGN_ID ?? "";
  const materials = env.OUTREACH_MATERIALS_CAMPAIGN_ID ?? "";
  const webhookSecret = env.OUTREACH_WEBHOOK_SECRET ?? "";
  if (![workspaceId, installer, materials].every((id) => uuid.safeParse(id).success)
      || installer === materials || webhookSecret.length < 32) return null;
  return { workspaceId, campaignIds: { installer_network: installer, materials_sales: materials }, webhookSecret };
}

export function validWebhookToken(header: string | null, secret: string): boolean {
  if (secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export class OutreachInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const eventSchema = z.object({
  workspace: uuid,
  campaign_id: uuid.optional().nullable(),
  timestamp: z.string().max(50).datetime({ offset: true }),
  event_type: z.string().min(1).max(100),
  lead_email: z.string().trim().email().max(320).optional().nullable(),
  email_account: z.string().trim().email().max(320).optional().nullable(),
  email_id: z.string().max(200).optional().nullable(),
  thread_id: z.string().max(200).optional().nullable(),
  reply_text: z.string().max(100_000).optional().nullable(),
  reply_text_snippet: z.string().max(10_000).optional().nullable(),
  reply_subject: z.string().max(2000).optional().nullable(),
  company_name: z.string().max(500).optional().nullable(),
});

const supportedEvents = new Set([
  "email_sent", "reply_received", "auto_reply_received", "email_bounced", "lead_unsubscribed",
  "lead_interested", "lead_not_interested", "lead_out_of_office", "lead_wrong_person",
  "lead_meeting_booked", "lead_meeting_completed", "lead_closed", "lead_neutral",
  "rf_installer_interested", "rf_quote_requested",
]);

export interface OutreachEvent {
  dedupeKey: string;
  workspaceId: string;
  campaignId: string | null;
  campaignKey: CampaignKey | null;
  type: string;
  email: string;
  occurredAt: string;
  mailbox: string | null;
  emailId: string | null;
  threadId: string | null;
  subject: string;
  body: string;
  bodyComplete: boolean;
  companyName: string | null;
  suppress: boolean;
}

// Only the newly authored text is eligible for intent checks. Quoted history
// is retained in the event body for staff, but cannot opt a contact out again.
export function authoredText(body: string): string {
  return body.split(/\n\s*(?:On .+wrote:|From:|_{3,}|-{2,}\s*Original Message|>)/i)[0].trim();
}

export function explicitOptOut(body: string): boolean {
  return /(?:^|[.!?]\s+|\n)(?:please\s+)?(?:unsubscribe\b|remove (?:me|us|my email|our email)\b|stop (?:emailing|contacting|messaging|sending)\b|(?:do not|don't) (?:email|contact|call|message) (?:me|us)\b)/i.test(authoredText(body));
}

export function normalizeInstantlyEvent(input: unknown, config: OutreachConfig): OutreachEvent | null {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) throw new OutreachInputError("Invalid Instantly event");
  const p = parsed.data;
  if (p.workspace !== config.workspaceId) throw new OutreachInputError("Workspace not allowed", 403);
  if (!supportedEvents.has(p.event_type)) return null;
  if (!p.lead_email) throw new OutreachInputError("Lead email is required");
  const campaignKey = campaignKeys.find((key) => config.campaignIds[key] === p.campaign_id) ?? null;
  // Workspace-wide stop signals are accepted even for another campaign. They
  // must not be lost just because this contact first opted out elsewhere.
  const body = p.reply_text ?? p.reply_text_snippet ?? "";
  const bodyComplete = p.reply_text != null;
  const suppress = p.event_type === "lead_unsubscribed" || p.event_type === "email_bounced"
    || (p.event_type === "reply_received" && bodyComplete && explicitOptOut(body));
  if (!campaignKey && !suppress) return null;
  const email = p.lead_email.toLowerCase();
  const occurredAt = new Date(p.timestamp).toISOString();
  const identity = [p.workspace, p.campaign_id ?? "", p.event_type, email,
    p.email_id || occurredAt];
  const dedupeKey = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return {
    dedupeKey, workspaceId: p.workspace, campaignId: p.campaign_id ?? null, campaignKey,
    type: p.event_type, email, occurredAt, mailbox: p.email_account?.toLowerCase() ?? null,
    emailId: p.email_id ?? null, threadId: p.thread_id ?? null, subject: p.reply_subject ?? "",
    body, bodyComplete, companyName: p.company_name ?? null, suppress,
  };
}

export type TaskKind = "review_reply" | "application_details" | "collect_quote_details" | "review_callback";
export interface OutreachPlan {
  intent: string;
  stage: string;
  tasks: Array<{ campaignKey: CampaignKey; kind: TaskKind; title: string }>;
  suppress: boolean;
}

function task(campaignKey: CampaignKey, kind: TaskKind, title: string) { return { campaignKey, kind, title }; }

// These rules route work to staff. They neither generate nor send customer
// messages. Unclear replies remain review tasks instead of guessed interest.
export function planOutreachEvent(event: OutreachEvent): OutreachPlan {
  const key = event.campaignKey;
  const base: OutreachPlan = { intent: "activity", stage: "contacted", tasks: [], suppress: false };
  if (event.suppress || (event.type === "reply_received" && event.bodyComplete && explicitOptOut(event.body))) {
    return { ...base, intent: "suppressed", stage: "suppressed", suppress: true };
  }
  if (!key) return base;
  if (["auto_reply_received", "lead_out_of_office"].includes(event.type)) return { ...base, intent: "out_of_office", stage: "later" };
  if (event.type === "lead_not_interested") return { ...base, intent: "declined", stage: "declined" };
  if (event.type === "email_sent") return base;
  if (event.type === "lead_closed") return { ...base, intent: "review_close", stage: "replied", tasks: [task(key, "review_reply", "Verify the outcome before closing")] };
  if (event.type === "lead_meeting_booked" || event.type === "lead_meeting_completed") {
    return { ...base, intent: "callback_review", stage: "replied", tasks: [task(key, "review_callback", "Review the meeting and agreed callback details")] };
  }
  if (["lead_interested", "rf_installer_interested", "rf_quote_requested"].includes(event.type)) {
    const target = event.type === "rf_installer_interested" ? "installer_network" : event.type === "rf_quote_requested" ? "materials_sales" : key;
    return { ...base, intent: "interested", stage: "interested", tasks: [target === "installer_network"
      ? task(target, "application_details", "Answer questions and provide application instructions")
      : task(target, "collect_quote_details", "Collect the project details for a quote")] };
  }
  const text = authoredText(event.body);
  if (event.type !== "reply_received" || !event.bodyComplete || !text) {
    return { ...base, intent: "needs_review", stage: "replied", tasks: [task(key, "review_reply", "Review the conversation in Instantly")] };
  }
  const declined = /\b(?:not interested|no thanks|no thank you)\b/i.test(text);
  const materials = /\b(?:can you|could you|please|need|looking for|send|want|request|would like)\b[^.!?\n]{0,100}\b(?:quote|pricing|materials|price)\b/i.test(text);
  const installer = /\b(?:join|apply|application|sign up)\b[^.!?\n]{0,80}\b(?:network|installer)\b|\b(?:installer|network)\b[^.!?\n]{0,80}\b(?:join|apply|application|sign up)\b/i.test(text);
  // Negative clauses are never used as a positive signal; a mixed reply is
  // reviewed by a person before either track advances.
  if (declined && (materials || installer)) return { ...base, intent: "mixed_reply", stage: "replied", tasks: [task(key, "review_reply", "Review the separate interests in this reply")] };
  if (declined) return { ...base, intent: "declined", stage: "declined" };
  if (/\b(?:not|don't|do not|no need|never)\b/i.test(text)) return { ...base, intent: "needs_review", stage: "replied", tasks: [task(key, "review_reply", "Review the request and its context")] };
  const tasks: OutreachPlan["tasks"] = [];
  if (installer) tasks.push(task("installer_network", "application_details", "Answer questions and provide application instructions"));
  if (materials) tasks.push(task("materials_sales", "collect_quote_details", "Collect the project details for a quote"));
  if (tasks.length) return { ...base, intent: tasks.length > 1 ? "both_interests" : "interested", stage: "interested", tasks };
  return { ...base, intent: "needs_review", stage: "replied", tasks: [task(key, "review_reply", "Review and answer the reply")] };
}
