export const outreachLeadStages = ['new', 'contacted', 'qualifying', 'quote_sent', 'follow_up', 'won', 'lost'] as const;
export type OutreachLeadStage = typeof outreachLeadStages[number];
export const GENERAL_INBOX = 'info@glassrailingstore.com';
export interface StaffLead {
  id: string; contact_id: string; case_id: string; interest_event_id: string;
  stage: OutreachLeadStage | 'suppressed'; owner_email: string | null;
  next_follow_up_at: string | null; next_action: string; notes: string; version: number;
  last_reply_at: string | null; last_staff_reply_at: string | null; mail_synced_at: string | null; mail_sync_error: string | null; created_at: string; updated_at: string;
  contact: { email: string; company_name: string | null };
  campaign: { campaign_key: 'installer_network' | 'materials_sales' };
}
