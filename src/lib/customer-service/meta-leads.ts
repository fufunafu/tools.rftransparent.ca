import {
  extractMetaLeadFields,
  findOrInsertLead,
  type UpsertLeadResult,
} from "@/lib/customer-service/leads";

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MAX_PAGES = 20;

interface GraphErrorPayload {
  error?: {
    message?: unknown;
    code?: unknown;
    error_subcode?: unknown;
  };
}

interface GraphPage<T> extends GraphErrorPayload {
  data?: T[];
  paging?: { next?: string };
}

interface MetaPage {
  id: string;
  name?: string;
}

interface MetaSubscribedApp {
  id: string;
  name?: string;
  subscribed_fields?: string[];
}

interface MetaForm {
  id: string;
  name?: string;
  status?: string;
}

export interface MetaLeadData {
  id: string;
  created_time?: string;
  form_id?: string;
  field_data?: Array<{ name?: unknown; values?: unknown }>;
}

export interface MetaConnectionStatus {
  configured: boolean;
  connected: boolean;
  page_name: string | null;
  subscribed: boolean;
  error: string | null;
}

export interface MetaSyncSummary {
  forms: number;
  fetched: number;
  inserted: number;
  deduped: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

function getPageAccessToken(): string {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new MetaGraphError("META_PAGE_ACCESS_TOKEN is not configured", 500, null, null);
  return token;
}

function graphUrl(pathOrUrl: string, token: string): string {
  const url = pathOrUrl.startsWith("https://")
    ? new URL(pathOrUrl)
    : new URL(`${GRAPH_API_BASE}/${pathOrUrl.replace(/^\/+/, "")}`);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  return url.toString();
}

async function graphGet<T>(pathOrUrl: string, token: string): Promise<T> {
  const response = await fetch(graphUrl(pathOrUrl, token), { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as GraphErrorPayload & T;
  if (!response.ok || body.error) {
    const detail = body.error;
    const message =
      typeof detail?.message === "string"
        ? detail.message
        : `Meta Graph API request failed with status ${response.status}`;
    throw new MetaGraphError(
      message,
      response.status,
      typeof detail?.code === "number" ? detail.code : null,
      typeof detail?.error_subcode === "number" ? detail.error_subcode : null,
    );
  }
  return body;
}

async function graphList<T>(path: string, token: string): Promise<T[]> {
  const rows: T[] = [];
  let next: string | null = path;

  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const body: GraphPage<T> = await graphGet<GraphPage<T>>(next, token);
    rows.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }

  return rows;
}

export function metaErrorMessage(error: unknown): string {
  if (!(error instanceof MetaGraphError)) {
    return error instanceof Error ? error.message : "Meta Graph API request failed";
  }
  if (error.code === 190 && error.subcode === 463) {
    return "Meta access token expired. Replace META_PAGE_ACCESS_TOKEN in Vercel.";
  }
  if (error.code === 190) {
    return "Meta access token is invalid. Replace META_PAGE_ACCESS_TOKEN in Vercel.";
  }
  return error.message;
}

export async function getMetaConnectionStatus(): Promise<MetaConnectionStatus> {
  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    return {
      configured: false,
      connected: false,
      page_name: null,
      subscribed: false,
      error: "META_PAGE_ACCESS_TOKEN is not configured.",
    };
  }

  try {
    const token = getPageAccessToken();
    const page = await graphGet<MetaPage>("me?fields=id,name", token);
    const apps = await graphList<MetaSubscribedApp>(
      "me/subscribed_apps?fields=id,name,subscribed_fields&limit=100",
      token,
    );
    const subscribed = apps.some(
      (app) => !Array.isArray(app.subscribed_fields) || app.subscribed_fields.includes("leadgen"),
    );
    return {
      configured: true,
      connected: true,
      page_name: page.name?.trim() || null,
      subscribed,
      error: subscribed ? null : "The Meta app is not subscribed to this Page's leadgen events.",
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      page_name: null,
      subscribed: false,
      error: metaErrorMessage(error),
    };
  }
}

export async function ingestMetaLead(
  lead: MetaLeadData,
  form: { id: string; name?: string },
  rawContext: Record<string, unknown>,
  options: { sendNotification?: boolean } = {},
): Promise<UpsertLeadResult> {
  const { name, email, phone, message } = extractMetaLeadFields(lead.field_data ?? []);
  const submittedAt =
    typeof lead.created_time === "string" && !Number.isNaN(Date.parse(lead.created_time))
      ? new Date(lead.created_time).toISOString()
      : null;

  return findOrInsertLead({
    source: "meta",
    source_detail: form.name?.trim() || `Meta form ${form.id}`,
    form_id: lead.form_id ?? form.id,
    page_url: null,
    name,
    email,
    phone,
    message,
    external_id: lead.id,
    submitted_at: submittedAt,
    send_notification: options.sendNotification,
    raw_payload: {
      meta_lead_id: lead.id,
      ...rawContext,
      lead,
    },
  });
}

export async function syncRecentMetaLeads(): Promise<MetaSyncSummary> {
  const token = getPageAccessToken();
  // This also produces a clear expired-token error before any form work starts.
  await graphGet<MetaPage>("me?fields=id,name", token);

  const forms = await graphList<MetaForm>(
    "me/leadgen_forms?fields=id,name,status&limit=100",
    token,
  );
  const summary: MetaSyncSummary = {
    forms: forms.length,
    fetched: 0,
    inserted: 0,
    deduped: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const form of forms) {
    try {
      const leads = await graphList<MetaLeadData>(
        `${encodeURIComponent(form.id)}/leads?fields=id,created_time,form_id,field_data&limit=100`,
        token,
      );
      summary.fetched += leads.length;

      for (const lead of leads) {
        try {
          const result = await ingestMetaLead(
            lead,
            form,
            { import: "manual_sync" },
            { sendNotification: false },
          );
          if (!result.ok) {
            summary.failed += 1;
            summary.errors.push(`${form.name ?? form.id}: ${result.error}`);
          } else if ("skipped" in result) {
            summary.skipped += 1;
          } else if (result.deduped) {
            summary.deduped += 1;
          } else {
            summary.inserted += 1;
          }
        } catch (error) {
          summary.failed += 1;
          summary.errors.push(`${form.name ?? form.id}: ${metaErrorMessage(error)}`);
        }
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(`${form.name ?? form.id}: ${metaErrorMessage(error)}`);
    }
  }

  summary.errors = summary.errors.slice(0, 10);
  return summary;
}
