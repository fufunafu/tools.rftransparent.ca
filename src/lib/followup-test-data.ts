// Browser-only test-mode store for the customer-service follow-up dashboard.
//
// Lives entirely in localStorage so practising follow-ups never touches the
// real Supabase tables or analytics. Seeded with 10 synthetic draft orders on
// first read. The shape matches FollowUpLead/FollowUpLog so the existing
// LeadTable, LeadDetailPanel, and FollowUpModal components can render them
// unchanged.

import {
  computeNextFollowup,
  DEFAULT_FOLLOWUP_DAYS,
  type FollowUpLead,
  type FollowUpLog,
  type LeadStatus,
} from "@/lib/followup";

const LEADS_KEY = "cs_followup_test_leads_v1";
const LOGS_KEY = "cs_followup_test_logs_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function daysFromNowISO(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function uuid(): string {
  // Cheap unique id — fine for client-only test data.
  return `test-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function seedLeads(): FollowUpLead[] {
  const now = new Date().toISOString();
  const base: Array<Partial<FollowUpLead> & {
    draft_name: string;
    customer_name: string;
    quote_amount: number;
    lead_status: LeadStatus;
    created_by_staff: string;
    contributors?: string[];
    daysSinceCreated: number;
    daysToFollowup: number;
  }> = [
    { draft_name: "#TD2001", customer_name: "Marie Tremblay", customer_email: "marie.t@example.com", customer_phone: "+15145550101", quote_amount: 4250, lead_status: "new", created_by_staff: "Anne", daysSinceCreated: 1, daysToFollowup: 0 },
    { draft_name: "#TD2002", customer_name: "Jonathan Lee", customer_email: "jon.lee@example.com", customer_phone: "+15145550102", quote_amount: 12800, lead_status: "hot_lead", created_by_staff: "Anne", contributors: ["Anne", "Jun"], daysSinceCreated: 2, daysToFollowup: -1 },
    { draft_name: "#TD2003", customer_name: "Sophie Bergeron", customer_email: "sophie.b@example.com", customer_phone: "+15145550103", quote_amount: 3100, lead_status: "considering", created_by_staff: "Jun", daysSinceCreated: 5, daysToFollowup: 2 },
    { draft_name: "#TD2004", customer_name: "Ahmed Khan", customer_email: "ahmed.k@example.com", customer_phone: "+15145550104", quote_amount: 7600, lead_status: "no_answer", created_by_staff: "Jun", daysSinceCreated: 4, daysToFollowup: -2 },
    { draft_name: "#TD2005", customer_name: "Olivia Roy", customer_email: "olivia.r@example.com", customer_phone: "+15145550105", quote_amount: 18900, lead_status: "price_shopping", created_by_staff: "Anne", contributors: ["Anne", "Fuanne"], daysSinceCreated: 6, daysToFollowup: 1 },
    { draft_name: "#TD2006", customer_name: "Liam Bouchard", customer_email: "liam.b@example.com", customer_phone: "+15145550106", quote_amount: 2400, lead_status: "future_project", created_by_staff: "Fuanne", daysSinceCreated: 10, daysToFollowup: 30 },
    { draft_name: "#TD2007", customer_name: "Emma Côté", customer_email: "emma.c@example.com", customer_phone: "+15145550107", quote_amount: 9500, lead_status: "new", created_by_staff: "Fuanne", daysSinceCreated: 0, daysToFollowup: 0 },
    { draft_name: "#TD2008", customer_name: "Noah Gauthier", customer_email: "noah.g@example.com", customer_phone: "+15145550108", quote_amount: 5400, lead_status: "hot_lead", created_by_staff: "Jun", daysSinceCreated: 3, daysToFollowup: 0 },
    { draft_name: "#TD2009", customer_name: "Camille Lefebvre", customer_email: "camille.l@example.com", customer_phone: "+15145550109", quote_amount: 6800, lead_status: "no_answer", created_by_staff: "Anne", daysSinceCreated: 7, daysToFollowup: -3 },
    { draft_name: "#TD2010", customer_name: "Lucas Dubois", customer_email: "lucas.d@example.com", customer_phone: "+15145550110", quote_amount: 14200, lead_status: "considering", created_by_staff: "Jun", daysSinceCreated: 8, daysToFollowup: 4 },
  ];

  return base.map((b) => {
    const createdAt = daysAgoISO(b.daysSinceCreated);
    const contributors = b.contributors ?? [b.created_by_staff];
    return {
      id: uuid(),
      store_id: "test",
      shopify_draft_id: `gid://shopify/DraftOrder/test-${b.draft_name.replace("#", "")}`,
      draft_name: b.draft_name,
      customer_name: b.customer_name,
      customer_email: b.customer_email ?? null,
      customer_phone: b.customer_phone ?? null,
      quote_amount: b.quote_amount,
      shopify_created_at: createdAt,
      shopify_status: "INVOICE_SENT",
      lead_status: b.lead_status,
      next_followup_at: daysFromNowISO(b.daysToFollowup),
      followup_count: 0,
      first_synced_at: createdAt,
      last_synced_at: now,
      closed_at: null,
      close_reason: null,
      notes: null,
      created_at: createdAt,
      updated_at: now,
      created_by_staff: b.created_by_staff,
      customer_orders_count: 0,
      last_invoice_sender: contributors[contributors.length - 1],
      contributors,
    };
  });
}

export function loadTestLeads(): FollowUpLead[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(LEADS_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as FollowUpLead[];
    } catch {
      // Corrupted state — reseed.
    }
  }
  const seeded = seedLeads();
  window.localStorage.setItem(LEADS_KEY, JSON.stringify(seeded));
  return seeded;
}

export function loadTestLogs(): FollowUpLog[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(LOGS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as FollowUpLog[];
  } catch {
    return [];
  }
}

function saveLeads(leads: FollowUpLead[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
}

function saveLogs(logs: FollowUpLog[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
}

export function resetTestData(): { leads: FollowUpLead[]; logs: FollowUpLog[] } {
  if (!isBrowser()) return { leads: [], logs: [] };
  const fresh = seedLeads();
  saveLeads(fresh);
  saveLogs([]);
  return { leads: fresh, logs: [] };
}

// Mirrors the real POST?action=log handler — applies an outcome to a lead
// (closing it if terminal, otherwise scheduling next follow-up) and inserts
// a log entry. Returns the updated lead.
export function logTestFollowUp(input: {
  lead_id: string;
  outcome: LeadStatus;
  notes?: string;
  close_reason?: string;
  custom_date?: string;
  loggedBy: string;
}): { lead: FollowUpLead | null; logs: FollowUpLog[]; leads: FollowUpLead[] } {
  const leads = loadTestLeads();
  const logs = loadTestLogs();
  const idx = leads.findIndex((l) => l.id === input.lead_id);
  if (idx === -1) return { lead: null, logs, leads };

  const now = new Date().toISOString();
  const lead = leads[idx];
  const terminal = input.outcome === "won" || input.outcome === "lost" || input.outcome === "duplicate";
  const nextFollowup = computeNextFollowup(input.outcome, DEFAULT_FOLLOWUP_DAYS, input.custom_date);

  const updated: FollowUpLead = {
    ...lead,
    lead_status: input.outcome,
    next_followup_at: nextFollowup,
    followup_count: lead.followup_count + 1,
    updated_at: now,
    closed_at: terminal ? now : lead.closed_at,
    close_reason: input.outcome === "lost" ? input.close_reason ?? null : lead.close_reason,
  };
  const nextLeads = [...leads];
  nextLeads[idx] = updated;

  const newLog: FollowUpLog = {
    id: uuid(),
    lead_id: input.lead_id,
    outcome: input.outcome,
    notes: input.notes ?? null,
    logged_by: input.loggedBy,
    created_at: now,
  };
  const nextLogs = [newLog, ...logs];

  saveLeads(nextLeads);
  saveLogs(nextLogs);
  return { lead: updated, logs: nextLogs, leads: nextLeads };
}

// Mirrors the real PATCH handler — updates editable fields on a lead.
export function patchTestLead(
  id: string,
  patch: Partial<Pick<FollowUpLead, "notes" | "next_followup_at" | "lead_status" | "close_reason">>,
): { lead: FollowUpLead | null; leads: FollowUpLead[] } {
  const leads = loadTestLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return { lead: null, leads };

  const now = new Date().toISOString();
  const merged: FollowUpLead = { ...leads[idx], ...patch, updated_at: now };
  const next = [...leads];
  next[idx] = merged;
  saveLeads(next);
  return { lead: merged, leads: next };
}

// Mirrors POST?action=bulk_close.
export function bulkCloseTestLeads(
  ids: string[],
  status: "lost" | "duplicate",
  close_reason?: string,
  loggedBy: string = "test user",
): { leads: FollowUpLead[]; logs: FollowUpLog[] } {
  const now = new Date().toISOString();
  const leads = loadTestLeads().map((l) =>
    ids.includes(l.id)
      ? {
          ...l,
          lead_status: status as LeadStatus,
          closed_at: now,
          next_followup_at: null,
          close_reason: close_reason ?? null,
          updated_at: now,
        }
      : l,
  );
  const newLogs: FollowUpLog[] = ids.map((id) => ({
    id: uuid(),
    lead_id: id,
    outcome: status,
    notes: close_reason ? `Bulk closed: ${close_reason}` : "Bulk closed",
    logged_by: loggedBy,
    created_at: now,
  }));
  const logs = [...newLogs, ...loadTestLogs()];
  saveLeads(leads);
  saveLogs(logs);
  return { leads, logs };
}

export function logsForLead(leadId: string): FollowUpLog[] {
  return loadTestLogs()
    .filter((l) => l.lead_id === leadId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
