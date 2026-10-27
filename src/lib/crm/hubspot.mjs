// Shared by the server worker and the resumable, read-only backup command.
// Never import this module from a client component or pass its token to the UI.
export const HUBSPOT_TYPES = ["contacts", "companies", "deals", "tickets", "calls", "meetings", "emails", "notes", "tasks"];
export const ACTIVITY_TYPES = ["calls", "meetings", "emails", "notes", "tasks"];

export class HubspotError extends Error {
  constructor(status, category = "REQUEST_FAILED") {
    super(`HubSpot request failed (${status}, ${category}).`);
    this.status = status;
    this.category = category;
  }
}

/** Only HubSpot's fixed API origin receives the credential. No redirects. */
export function hubspotClient(token, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!token) throw new Error("HubSpot is not configured.");
  return async function request(path, body) {
    if (!path.startsWith("/crm/") && path !== "/account-info/v3/details") throw new Error("Unsupported HubSpot API path.");
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetcher(`https://api.hubapi.com${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const retry = Number(response.headers.get("retry-after"));
        await sleep(Math.min(15_000, Math.max(500 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0)));
        continue;
      }
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const category = response.status === 400 && /^Paging through deleted objects is not yet supported for object type /.test(failure.message ?? "")
          ? "ARCHIVE_NOT_SUPPORTED" : "REQUEST_FAILED";
        throw new HubspotError(response.status, category);
      }
      const data = await response.json();
      if (data.errors?.length || data.status === "PENDING" || data.status === "PROCESSING") throw new HubspotError(502, "INCOMPLETE_BATCH");
      return data;
    }
    throw new HubspotError(503);
  };
}

export function recordKey(portalId, type, id) { return `hubspot:${portalId}:${type}:${id}`; }

export function textFromHtml(value) {
  return String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function dateValue(value) {
  if (!value) return null;
  const parsed = /^\d{10,}$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeHubspotRecord(portalId, type, raw, owners = {}) {
  const p = raw.properties ?? {};
  const titles = {
    contacts: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email,
    companies: p.name || p.domain, deals: p.dealname, tickets: p.subject,
    calls: p.hs_call_title, meetings: p.hs_meeting_title, emails: p.hs_email_subject,
    notes: "Note", tasks: p.hs_task_subject,
  };
  const body = textFromHtml(p.hs_note_body || p.hs_call_body || p.hs_meeting_body || p.hs_email_text || p.hs_email_html || p.hs_task_body || p.content || "");
  return {
    id: recordKey(portalId, type, raw.id), object_type: type, source: "hubspot",
    hubspot_id: String(raw.id), portal_id: String(portalId),
    title: String(titles[type] || `${type} ${raw.id}`),
    summary: [p.email, p.phone, p.company, p.domain, p.dealstage, p.hs_pipeline_stage].filter(Boolean).join(" · "),
    body, owner_email: owners[p.hubspot_owner_id]?.email?.toLowerCase() ?? null,
    occurred_at: dateValue(p.hs_timestamp || raw.createdAt),
    due_at: type === "tasks" ? dateValue(p.hs_timestamp) : null,
    task_status: type === "tasks" ? (p.hs_task_status === "COMPLETED" ? "completed" : "open") : null,
    archived: raw.archived === true, properties: p,
    property_history: raw.propertiesWithHistory ?? {}, raw,
    source_created_at: dateValue(raw.createdAt), source_updated_at: dateValue(raw.updatedAt),
  };
}

export async function readOwners(request) {
  const owners = {};
  for (const archived of [false, true]) {
    let after;
    do {
      const query = new URLSearchParams({ limit: "100", archived: String(archived) });
      if (after) query.set("after", after);
      const page = await request(`/crm/v3/owners/?${query}`);
      for (const owner of page.results) owners[owner.id] = owner;
      after = page.paging?.next?.after;
    } while (after);
  }
  return owners;
}

/**
 * Full property values/history and all core associations, without the search API's 10k ceiling.
 * @param {Function} request
 * @param {{portalId: string, type: string, properties: string[], owners: object, after?: string|null, archived?: boolean}} options
 */
export async function readHubspotPage(request, { portalId, type, properties, owners, after = null, archived = false }) {
  if (!HUBSPOT_TYPES.includes(type)) throw new Error("Unsupported object type.");
  // HubSpot caps batch reads with property history at 50 records.
  const query = new URLSearchParams({ limit: "50", archived: String(archived), associations: HUBSPOT_TYPES.join(",") });
  if (after !== null) query.set("after", String(after));
  let page;
  try { page = await request(`/crm/v3/objects/${type}?${query}`); }
  catch (error) {
    if (archived && error instanceof HubspotError && error.category === "ARCHIVE_NOT_SUPPORTED") {
      return { records: [], links: [], after: null, unavailable: `HubSpot does not expose archived ${type} through this API.` };
    }
    throw error;
  }
  if (!Array.isArray(page.results)) throw new Error("HubSpot returned an invalid record page.");
  let records = [];
  if (page.results.length) {
    const batch = await request(`/crm/v3/objects/${type}/batch/read?archived=${archived}`, {
      inputs: page.results.map(record => ({ id: record.id })), properties, propertiesWithHistory: properties,
    });
    const expected = new Set(page.results.map(record => String(record.id)));
    if (!Array.isArray(batch.results) || batch.results.length !== expected.size || batch.results.some(record => !expected.delete(String(record.id))) || expected.size) {
      throw new Error("HubSpot returned an incomplete page. Retry without advancing the checkpoint.");
    }
    records = batch.results.map(record => normalizeHubspotRecord(portalId, type, record, owners));
  }
  const links = [];
  for (const raw of page.results) {
    for (const [targetType, initial] of Object.entries(raw.associations ?? {})) {
      if (!HUBSPOT_TYPES.includes(targetType)) continue;
      let associationPage = initial;
      const cursors = new Set();
      do {
        for (const target of associationPage.results ?? []) links.push({
          from_id: recordKey(portalId, type, raw.id), to_id: recordKey(portalId, targetType, target.id),
          label: target.type ?? "associated", source: "hubspot",
        });
        const next = associationPage.paging?.next?.after;
        if (next === undefined || next === null) break;
        if (cursors.has(String(next))) throw new Error("Repeated association cursor.");
        cursors.add(String(next));
        const params = new URLSearchParams({ limit: "500", after: String(next) });
        associationPage = await request(`/crm/v3/objects/${type}/${encodeURIComponent(raw.id)}/associations/${targetType}?${params}`);
      } while (true);
    }
  }
  return { records, links, after: page.paging?.next?.after ?? null };
}
