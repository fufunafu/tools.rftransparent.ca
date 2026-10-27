export const outreachLeadStages = ['new', 'contacted', 'qualifying', 'quote_sent', 'follow_up', 'won', 'lost'] as const;
export type OutreachLeadStage = typeof outreachLeadStages[number];
export const GENERAL_INBOX = 'info@glassrailingstore.com';
export const callResults = ['connected', 'no_answer', 'voicemail', 'wrong_number'] as const;
export type CallResult = typeof callResults[number];
export const callResultLabels: Record<CallResult, string> = {
  connected: 'Spoke to client', no_answer: 'No answer', voicemail: 'Left voicemail', wrong_number: 'Wrong number',
};
export interface LeadActivity {
  id: string; lead_id: string; kind: 'call' | 'quote' | 'note'; actor_email: string; actor_name: string;
  occurred_at: string; created_at: string; note: string; call_result: CallResult | null;
  quote_number: string | null; quote_amount: number | string | null; quote_currency: 'USD' | 'CAD' | null; quote_url: string | null;
}
export interface LeadSummary { open: number; needsCall: number | null; quoted: number | null; due: number }
export interface LeadSync { status: string; lastRunAt: string }
export interface StaffLead {
  id: string; contact_id: string; case_id: string; interest_event_id: string;
  stage: OutreachLeadStage | 'suppressed'; owner_email: string | null;
  next_follow_up_at: string | null; next_action: string; notes: string; version: number;
  last_reply_at: string | null; last_staff_reply_at: string | null; mail_synced_at: string | null; mail_sync_error: string | null; created_at: string; updated_at: string;
  contact: { email: string; company_name: string | null };
  campaign: { campaign_key: 'installer_network' | 'materials_sales' };
  call_source?: 'automatic'; quote_source?: 'automatic'; activity_error?: boolean;
  contact_name: string; phone: string; call_count: number;
  last_call_at: string | null; last_called_by: string | null; last_called_by_name: string | null; last_call_result: CallResult | null;
  quote_number: string | null; quote_amount: number | string | null; quote_currency: 'USD' | 'CAD' | null;
  quote_url: string | null; quote_sent_at: string | null; quoted_by: string | null; quoted_by_name: string | null;
}

export function safeQuoteLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function leadIsClosed(stage: StaffLead['stage']): boolean {
  return ['won', 'lost', 'suppressed'].includes(stage);
}
