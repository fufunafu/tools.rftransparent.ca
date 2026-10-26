export const campaignKeys = ["installer_network", "materials_sales"] as const;
export type CampaignKey = typeof campaignKeys[number];
export const campaignNames: Record<CampaignKey, string> = {
  installer_network: "Installer network",
  materials_sales: "Materials sales",
};

export interface OutreachReadiness {
  configured: boolean;
  apiKeyPresent: boolean;
  workerEnabled: boolean;
  connectionVerified: boolean;
  customerSendingEnabled: boolean;
  missing: string[];
}
export interface OutreachContact {
  id: string;
  email: string;
  company_name: string | null;
  paused: boolean;
  owner_email: string | null;
  suppressed_at: string | null;
  suppression_reason: string | null;
  suppression_synced_at: string | null;
  updated_at: string;
}
export interface OutreachCase {
  id: string;
  contact_id: string;
  campaign_key: CampaignKey;
  provider_campaign_id: string | null;
  stage: string;
}
export interface OutreachTask {
  id: string;
  case_id: string;
  event_id: string;
  kind: string;
  title: string;
  status: string;
  notes: string | null;
  updated_at: string;
}
export interface OutreachOverview {
  contacts: OutreachContact[];
  cases: OutreachCase[];
  tasks: OutreachTask[];
  attention: Array<{ id: string; contact_id: string; status: string; error_code: string | null; event_type: string; created_at: string }>;
  total: number;
  pending: number;
  readiness: OutreachReadiness;
}
export interface OutreachHistory {
  contact: OutreachContact | null;
  cases: OutreachCase[];
  tasks: OutreachTask[];
  events: Array<{ id: string; event_type: string; occurred_at: string; status: string; error_code: string | null;
    event: { body: string; bodyComplete: boolean; subject: string; mailbox: string | null; campaignKey: CampaignKey | null; threadId: string | null };
    plan: { intent?: string } | null }>;
  audit: Array<{ actor_email: string; action: string; detail: { note?: string }; created_at: string }>;
}
