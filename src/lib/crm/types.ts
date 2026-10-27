export const CRM_TYPES = ["contacts", "companies", "deals", "tickets", "calls", "meetings", "emails", "notes", "tasks"] as const;
export type CrmType = typeof CRM_TYPES[number];
export const CRM_RECORD_VIEWS = ["full", "summary", "detail", "fields", "history"] as const;
export type CrmRecordView = typeof CRM_RECORD_VIEWS[number];
export const CRM_INITIAL_LIST_URL = "/api/crm?type=contacts&q=&page=0&status=open&mine=false&overdue=false&archived=false";
export const CRM_LABELS: Record<CrmType, string> = {
  contacts: "Contacts", companies: "Companies", deals: "Deals", tickets: "Tickets", calls: "Calls", meetings: "Meetings", emails: "Emails", notes: "Notes", tasks: "Tasks",
};
export interface CrmRecord {
  id: string;
  object_type: CrmType;
  source: "tools" | "hubspot";
  portal_id: string | null;
  hubspot_id: string | null;
  title: string;
  summary: string;
  body?: string;
  owner_email: string | null;
  occurred_at: string | null;
  effective_due_at: string | null;
  effective_task_status: "open" | "completed" | null;
  archived: boolean;
  version: number;
  properties?: Record<string, unknown>;
  property_history?: Record<string, unknown>;
  created_by_email: string | null;
  source_created_at?: string | null;
  source_updated_at?: string | null;
  imported_at?: string | null;
}
export interface CrmPage { records: CrmRecord[]; total: number; page: number }
export interface CrmStatus {
  configured: boolean;
  counts: { object_type: CrmType; source: string; total: number }[];
  sync: { status: string; last_error: string | null; updated_at: string; progress: Record<string, unknown> } | null;
}
