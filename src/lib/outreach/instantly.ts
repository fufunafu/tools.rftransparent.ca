import type { OutreachEvent } from "./domain";

export interface EmailRecord {
  id?: string;
  organization_id?: string;
  campaign_id?: string | null;
  lead?: string;
  eaccount?: string;
  ue_type?: number;
  is_auto_reply?: number;
  timestamp_email?: string;
  thread_id?: string | null;
  subject?: string;
  from_address_email?: string;
  body?: { text?: string; html?: string };
}

export class InstantlyError extends Error {
  constructor(public code: string) { super(code); }
}

export interface LeadProfile { company: string; name: string; phone: string }
export async function getLeadProfile(event: OutreachEvent, key: string, fetcher: typeof fetch = fetch): Promise<LeadProfile> {
  if (!event.campaignId) throw new InstantlyError('instantly_lead_mismatch');
  let response: Response;
  try {
    response = await fetcher('https://api.instantly.ai/api/v2/leads/list', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'RF-Tools-Outreach/1.0' },
      body: JSON.stringify({campaign:event.campaignId,contacts:[event.email],limit:2}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),
    });
  } catch { throw new InstantlyError('instantly_unavailable'); }
  if (!response.ok) throw new InstantlyError(`instantly_http_${response.status}`);
  const value = await response.json() as {items?: Array<{email?:string;organization?:string;campaign?:string;company_name?:string;first_name?:string;last_name?:string;phone?:string}>};
  if (!Array.isArray(value.items) || value.items.length!==1) throw new InstantlyError('instantly_lead_mismatch');
  const lead=value.items[0];
  if (lead.email?.toLowerCase()!==event.email || lead.organization!==event.workspaceId || lead.campaign!==event.campaignId) throw new InstantlyError('instantly_lead_mismatch');
  const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
  return {company:text(lead.company_name,500),name:[text(lead.first_name,100),text(lead.last_name,100)].filter(Boolean).join(' ').slice(0,200),phone:text(lead.phone,60)};
}

export async function getJson(path: string, key: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`https://api.instantly.ai/api/v2/${path}`, {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "RF-Tools-Outreach/1.0" }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new InstantlyError("instantly_unavailable"); }
  if (!response.ok) throw new InstantlyError(`instantly_http_${response.status}`);
  try { return await response.json(); } catch { throw new InstantlyError("instantly_invalid_response"); }
}

function belongsToEvent(email: EmailRecord, event: OutreachEvent): boolean {
  return email.organization_id === event.workspaceId
    && email.campaign_id === event.campaignId
    && email.lead?.toLowerCase() === event.email
    && email.ue_type === 2 && email.is_auto_reply !== 1
    && (!event.mailbox || email.eaccount?.toLowerCase() === event.mailbox)
    && (!event.threadId || email.thread_id === event.threadId);
}

// Never substitute the latest email from another campaign or a later reply.
// Ambiguous or HTML-only records stay in the staff review path.
export async function hydrateReply(event: OutreachEvent, key: string | undefined, fetcher: typeof fetch = fetch): Promise<OutreachEvent> {
  if (event.type !== "reply_received" || event.bodyComplete || !key || !event.campaignId) return event;
  let matched: EmailRecord | undefined;
  if (event.emailId) {
    const record = await getJson(`emails/${encodeURIComponent(event.emailId)}`, key, fetcher) as EmailRecord;
    if (!record || record.id !== event.emailId || !belongsToEvent(record, event)) throw new InstantlyError("instantly_thread_mismatch");
    matched = record;
  } else {
    const candidates: EmailRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const params = new URLSearchParams({ lead: event.email, campaign_id: event.campaignId, limit: "100", preview_only: "false", mode: "emode_all" });
      if (event.mailbox) params.set("eaccount", event.mailbox);
      if (event.threadId) params.set("search", `thread:${event.threadId}`);
      if (cursor) params.set("starting_after", cursor);
      const result = await getJson(`emails?${params}`, key, fetcher) as { items?: EmailRecord[]; next_starting_after?: string };
      if (!result || !Array.isArray(result.items)) throw new InstantlyError("instantly_invalid_response");
      candidates.push(...result.items.filter((record) => belongsToEvent(record, event)
        && Math.abs(Date.parse(record.timestamp_email ?? "") - Date.parse(event.occurredAt)) <= 120_000));
      if (!result.next_starting_after) break;
      if (result.next_starting_after === cursor || page === 2) return event;
      cursor = result.next_starting_after;
    }
    if (candidates.length !== 1) return event;
    matched = candidates[0];
  }
  if (typeof matched.body?.text !== "string" || matched.body.text.length > 100_000) return event;
  return { ...event, body: matched.body.text, bodyComplete: true, emailId: matched.id ?? event.emailId,
    mailbox: matched.eaccount?.toLowerCase() ?? event.mailbox, threadId: matched.thread_id ?? event.threadId,
    subject: (matched.subject ?? event.subject).slice(0, 2000) };
}
