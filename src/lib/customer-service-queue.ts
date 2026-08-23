export interface PersonalCallback {
  store_id: string;
  from_number: string;
  note: string | null;
  status: string | null;
  assigned_to: string | null;
  updated_at: string | null;
  priority?: string;
  last_call?: string;
}

export interface PersonalFollowup {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  draft_name: string;
  quote_amount: number | string | null;
  lead_status: string;
  next_followup_at: string | null;
  assigned_to: string | null;
}

export interface CustomerServiceQueueState {
  callbacks: PersonalCallback[];
  followups: PersonalFollowup[];
}

export type QueueItemType = "callback" | "followup";
export type QueueAction = "claim" | "release";
