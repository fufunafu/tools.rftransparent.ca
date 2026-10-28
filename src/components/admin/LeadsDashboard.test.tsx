// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/customer-service/leads";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import LeadsDashboard, { LEAD_ROWS_PER_PAGE } from "./LeadsDashboard";

const NOW = Date.parse("2026-10-26T16:00:00Z");
const BOUNDS = leadTrendQueryBounds("30d", new Date(NOW));

let root: Root;
let container: HTMLDivElement;

function makeLeads(count: number): Lead[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `lead-${index}`,
    store_id: "rf_transparent",
    source: "website",
    name: `Customer ${index}`,
    email: `customer${index}@example.com`,
    phone: null,
    installation_requested: false,
    submitted_at: new Date(NOW - (index + 1) * 60 * 60 * 1000).toISOString(),
    call_status: "called",
    outcome: "new",
    quote_number: null,
    quote_amount: null,
    quote_sent_at: null,
    lost_reason: null,
    not_applicable_reason: null,
    notes: null,
    assigned_to: null,
  })) as unknown as Lead[];
}

function leadRows(): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .filter((row) => row.textContent?.includes("Customer "));
}

async function chooseFilters(kind: string, values: string[]) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Filter leads by ${kind}"]`)!;
  if (button.getAttribute("aria-expanded") !== "true") await act(async () => button.click());
  const group = container.querySelector<HTMLElement>(`[role="group"][aria-label="Filter leads by ${kind}"]`)!;
  const clear = [...group.querySelectorAll("button")].find(button => button.textContent === "Clear")!;
  await act(async () => clear.click());
  for (const value of values) await act(async () => group.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(button.getAttribute("aria-expanded")).toBe("false");
}

function listRequests(): string[] {
  return vi.mocked(fetch).mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/customer-service/leads?store="));
}

type Respond = (url: string, init?: RequestInit) => unknown;

async function render(leads: Lead[], store: Lead["store_id"] = "bc_transparent", options: { respond?: Respond; initialStale?: boolean } = {}) {
  // The API serves the same list the server rendered, so a repeat download
  // would not change what the table shows.
  vi.stubGlobal("fetch", vi.fn(async (url, init) => new Response(JSON.stringify(options.respond?.(String(url), init) ?? (String(url).includes("sync-status") ? { sources: [], canSync: false } : { leads })))));
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LeadsDashboard
          initialLeads={leads}
          initialStale={options.initialStale}
          initialNow={NOW}
          initialBounds={BOUNDS}
          store={store}
          currentUserEmail="employee@example.com"
        />
      </SWRConfig>,
    );
  });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ leads: [] }))));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("draws the first page of leads and adds more on request", async () => {
  await render(makeLeads(120));
  expect(leadRows()).toHaveLength(LEAD_ROWS_PER_PAGE);
  expect(container.textContent).toContain(`Showing ${LEAD_ROWS_PER_PAGE} of 120 leads`);

  const showMore = [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "Show more")!;
  await act(async () => showMore.click());
  expect(leadRows()).toHaveLength(LEAD_ROWS_PER_PAGE * 2);
});

it("hides the show-more control once every lead is drawn", async () => {
  await render(makeLeads(20));
  expect(leadRows()).toHaveLength(20);
  expect(container.textContent).not.toContain("Show more");
});

it("does not download the server-rendered list again on load", async () => {
  await render(makeLeads(5));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(listRequests()).toEqual([]);
});


it("labels outreach leads and filters them without hiding website leads from All sources", async () => {
  const leads = makeLeads(2);
  leads[1].source = "outreach";
  await render(leads, "rf_transparent");
  expect(leadRows()).toHaveLength(2);
  expect(leadRows().some((row) => row.textContent?.includes("Outreach"))).toBe(true);
  await chooseFilters("source", ["outreach"]);
  expect(leadRows()).toHaveLength(1);
  expect(leadRows()[0].textContent).toContain("Customer 1");
});

it('excludes old website leads by default and only includes older open work when requested', async () => {
  const leads = makeLeads(3);
  leads[0].submitted_at = '2024-01-01T00:00:00Z';
  leads[1].submitted_at = '2024-01-02T00:00:00Z';
  leads[1].outcome = 'won';
  await render(leads, 'rf_transparent');
  await chooseFilters("source", ["website"]);
  expect(leadRows()).toHaveLength(1);
  expect(leadRows()[0].textContent).toContain('Customer 2');
  expect(container.textContent).toContain('Received in the last 30 days');
  const older = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => older.click());
  expect(leadRows()).toHaveLength(2);
  expect(listRequests().some(url => url.includes('include_open=true'))).toBe(true);
  await act(async () => older.click());
  expect(leadRows()).toHaveLength(1);
});
it('allows historical website leads through the explicit All time received filter', async () => {
  const leads = makeLeads(1); leads[0].submitted_at = '2024-01-01T00:00:00Z';
  await render(leads, 'rf_transparent'); expect(leadRows()).toHaveLength(0);
  const dates = container.querySelector<HTMLSelectElement>('select[aria-label="Lead received date range"]')!;
  await act(async () => { dates.value = 'all'; dates.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(leadRows()).toHaveLength(1);
});
it('defaults to newest despite a saved priority preference and supports the My leads view', async () => {
  const leads = makeLeads(3);
  sessionStorage.setItem('rf-lead-queue:v2:bc_transparent', JSON.stringify({ sort: 'priority' }));
  leads[0].submitted_at = '2026-10-26T14:00:00Z';
  leads[1].submitted_at = '2026-10-25T14:00:00Z';
  leads[2].submitted_at = '2026-10-24T14:00:00Z';
  leads[2].next_follow_up_at = '2026-10-25T10:00:00Z';
  leads[2].assigned_to = 'employee@example.com';
  await render(leads);
  expect(leadRows()[0].textContent).toContain('Customer 0');
  const sort = container.querySelector<HTMLSelectElement>('select[aria-label="Sort leads"]')!;
  expect(sort.value).toBe('newest');
  expect([...sort.options].map(option => option.value)).toEqual(['newest', 'oldest']);
  await act(async () => { sort.value = 'oldest'; sort.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(leadRows()[0].textContent).toContain('Customer 2');
  await chooseFilters("owner", ["mine"]);
  expect(leadRows()).toHaveLength(1);
});
it('keeps spam out of the queue without a persistent banner and keeps phone numbers callable', async () => {
  const leads = makeLeads(2);
  leads[0].phone = '+1 416 555 0123';
  leads[1].outcome = 'not_applicable'; leads[1].not_applicable_reason = 'Spam: marketing solicitation';
  await render(leads);
  expect(container.textContent).not.toContain('spam excluded');
  expect(leadRows()).toHaveLength(1);
  expect(container.querySelector('a[href="tel:+14165550123"]')).not.toBeNull();
});

it('keeps open summary and queue consistent when a legacy spam record has an open stage', async () => {
  const leads = makeLeads(2);
  leads[1].not_applicable_reason = 'Spam: marketing solicitation';
  await render(leads);
  expect(leadRows()).toHaveLength(1);
  expect(container.textContent).toContain('Open leads1');
  expect(container.textContent).toContain('1 lead matching filters');
  await chooseFilters("status", ["spam"]);
  expect(leadRows()).toHaveLength(1);
  expect(leadRows()[0].textContent).toContain('Customer 1');
});

it('keeps analytics accessible on the queue page without expanding it by default', async () => {
  await render(makeLeads(2));
  const analytics = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Show analytics'))!;
  expect(analytics.getAttribute('aria-expanded')).toBe('false');
  await act(async () => analytics.click());
  expect(analytics.getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('#lead-analytics')).not.toBeNull();
  expect(leadRows()).toHaveLength(2);
});

it("combines sources, statuses and owner selections, persists them and resets", async () => {
  const leads = makeLeads(5);
  leads[0].source = "website";
  leads[0].assigned_to = "employee@example.com";
  leads[1].source = "meta";
  leads[1].outcome = "won";
  leads[2].source = "outreach";
  leads[3].source = "meta";
  leads[3].assigned_to = "another@example.com";
  leads[4].source = "website";
  leads[4].outcome = "lost";
  await render(leads, "rf_transparent");
  await chooseFilters("source", ["website", "meta"]);
  await chooseFilters("status", ["open", "won"]);
  await chooseFilters("owner", ["mine", "unassigned"]);
  expect(leadRows().map(row => row.textContent?.match(/Customer \d/)?.[0])).toEqual(["Customer 0", "Customer 1"]);
  const saved = JSON.parse(sessionStorage.getItem("rf-lead-queue:v2:rf_transparent")!);
  expect(saved.source).toBe("website,meta");
  expect(saved.status).toBe("open,won");
  expect(saved.owner).toBe("mine,unassigned");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render(leads, "rf_transparent");
  expect(leadRows()).toHaveLength(2);
  await chooseFilters("source", []);
  expect(leadRows()).toHaveLength(0);
  const reset = [...container.querySelectorAll("button")].find(button => button.textContent === "Reset")!;
  await act(async () => reset.click());
  expect(leadRows()).toHaveLength(3);
});

it("can exclude Outreach directly from All sources and closes on outside click", async () => {
  const leads = makeLeads(3); leads[1].source = "meta"; leads[2].source = "outreach";
  await render(leads, "rf_transparent");
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Filter leads by source"]')!;
  await act(async () => trigger.click());
  const group = container.querySelector('[role="group"][aria-label="Filter leads by source"]')!;
  expect([...group.querySelectorAll<HTMLInputElement>("input")].every(input => input.checked)).toBe(true);
  await act(async () => group.querySelector<HTMLInputElement>('input[value="outreach"]')!.click());
  expect(leadRows()).toHaveLength(2);
  expect(trigger.textContent).toContain("Source");
  expect(trigger.getAttribute("title")).toBe("Website, Meta");
  expect(container.textContent).toContain("Source: Website, Meta");
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("distinguishes phone evidence, employee markings, and legacy unattributed statuses", async () => {
  const rows = makeLeads(3).map(row => ({ ...row, phone: "4165550123" }));
  rows[0] = { ...rows[0], last_call_at: "2026-10-26T14:00:00Z", last_called_by: "Daniel" };
  rows[1] = { ...rows[1], call_status_source: "manual", call_status_changed_by: "employee@example.com", call_status_changed_at: "2026-10-26T15:00:00Z" };
  await render(rows);
  const rendered = leadRows();
  expect(rendered[0].textContent).toContain("Phone record: Daniel");
  expect(rendered[0].textContent).not.toContain("unverified");
  expect(rendered[1].textContent).toContain("Called · manual");
  expect(rendered[1].textContent).toContain("Manually marked called by employee@example.com");
  expect(rendered[1].textContent).toContain("No linked phone record");
  expect(rendered[2].textContent).toContain("Called · unverified");
  expect(rendered[2].textContent).toContain("Who marked this: not recorded");
  expect(rendered[2].textContent).not.toContain("Manually marked");
});


it("keeps field labels visible and removes a selected filter without changing other fields", async () => {
  const leads = makeLeads(3); leads[1].source = "meta"; leads[2].source = "outreach";
  await render(leads, "rf_transparent");
  await chooseFilters("source", ["outreach"]);
  const toolbar = container.querySelector('[role="group"][aria-label="Lead filters"]')!;
  expect(toolbar.textContent).toContain("Owner");
  expect(toolbar.textContent).toContain("Source");
  expect(toolbar.textContent).toContain("Received date");
  expect(toolbar.textContent).toContain("Lead status");
  expect(leadRows()).toHaveLength(1);
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove Source: Outreach filter"]')!;
  await act(async () => remove.click());
  expect(leadRows()).toHaveLength(3);
  const saved = JSON.parse(sessionStorage.getItem("rf-lead-queue:v2:rf_transparent")!);
  expect(saved).toMatchObject({ source: "all", status: "open", history: "30d" });
});

const DAY_MS = 86_400_000;

function patchBodies(): Record<string, unknown>[] {
  return vi.mocked(fetch).mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

async function openLead(name: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === name)!;
  await act(async () => button.click());
  await settle();
}

function panelButton(label: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent === label)!;
}

it("limits the received-date filter to the chosen number of days", async () => {
  const leads = makeLeads(3);
  leads[0].submitted_at = new Date(NOW - 10 * DAY_MS).toISOString();
  leads[1].submitted_at = new Date(NOW - 45 * DAY_MS).toISOString();
  leads[2].submitted_at = new Date(NOW - 100 * DAY_MS).toISOString();
  await render(leads, "rf_transparent");
  expect(leadRows().map((row) => row.textContent?.match(/Customer \d/)?.[0])).toEqual(["Customer 0"]);
  const dates = container.querySelector<HTMLSelectElement>('select[aria-label="Lead received date range"]')!;
  await act(async () => { dates.value = "90d"; dates.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  expect(leadRows().map((row) => row.textContent?.match(/Customer \d/)?.[0])).toEqual(["Customer 0", "Customer 1"]);
});

it("refreshes on load when the server list is older than the cache window", async () => {
  await render(makeLeads(2), "bc_transparent", { initialStale: true });
  await settle();
  expect(listRequests()).toHaveLength(1);
});

it("shows and edits only the submissions combined in the selected row", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { phone: "4165550123", call_status: "not_called", duplicate_count: 2, duplicate_ids: ["lead-0", "lead-0-repeat"] });
  await render([lead], "rf_transparent", {
    respond: (url) => url.includes("view=details")
      // The server's all-time group can be wider than this row.
      ? { lead_ids: ["lead-0", "lead-0-repeat", "older-or-other-store"], details: [] }
      : url.includes("view=call_attempts") ? { attempts: [] } : { leads: [lead] },
  });
  await openLead("Customer 0");
  const requested = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(requested.some((url) => url.includes("view=details&lead_ids=lead-0%2Clead-0-repeat"))).toBe(true);
  await act(async () => panelButton("Mark as called").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ ids: ["lead-0", "lead-0-repeat"], call_status: "called", outcome: "contacted" })]);
});

it("shows the reason for the current stage after switching between Lost and Not Applicable", async () => {
  let lead = { ...makeLeads(1)[0], outcome: "lost", lost_reason: "Chose a competitor" } as Lead;
  await render([lead], "rf_transparent", {
    respond: (url, init) => {
      if (init?.method === "PATCH") {
        lead = { ...lead, ...JSON.parse(String(init.body)) };
        return { ok: true };
      }
      return url.includes("view=details") ? { lead_ids: [lead.id], details: [] }
        : url.includes("view=call_attempts") ? { attempts: [] } : { leads: [lead] };
    },
  });
  await chooseFilters("status", ["lost"]);
  await openLead("Customer 0");
  expect(container.querySelector<HTMLInputElement>('input[placeholder="Lost reason"]')!.value).toBe("Chose a competitor");
  await act(async () => panelButton("Not Applicable").click());
  await settle();
  const reason = container.querySelector<HTMLInputElement>('input[placeholder^="Reason, such as spam"]')!;
  expect(reason.value).toBe("");
});

it("takes a spam lead out of spam when staff choose a working stage", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { outcome: "not_applicable", not_applicable_reason: "Spam: marketing solicitation" });
  await render([lead], "rf_transparent", { respond: (url) => url.includes("view=details") ? { lead_ids: [lead.id], details: [] } : url.includes("view=call_attempts") ? { attempts: [] } : { leads: [lead] } });
  await chooseFilters("status", ["spam"]);
  await openLead("Customer 0");
  await act(async () => panelButton("Contacted").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ outcome: "contacted", not_applicable_reason: null })]);
});

it("restores a quoted lead from spam to Quoted instead of New", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { outcome: "not_applicable", not_applicable_reason: "Spam: marketing solicitation", quote_number: "D-1042" });
  await render([lead], "rf_transparent", { respond: (url) => url.includes("view=details") ? { lead_ids: [lead.id], details: [] } : url.includes("view=call_attempts") ? { attempts: [] } : { leads: [lead] } });
  await chooseFilters("status", ["spam"]);
  await openLead("Customer 0");
  await act(async () => panelButton("Restore from spam").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ outcome: "quoted", not_applicable_reason: null })]);
});

function panelResponder(getLead: () => Lead, extra: Respond = () => undefined): Respond {
  return (url, init) => extra(url, init) ?? (url.includes("view=details") ? { lead_ids: [getLead().id], details: [] }
    : url.includes("view=call_attempts") ? { attempts: [] }
      : url.includes("view=missed_calls") ? { calls: [] } : { leads: [getLead()] });
}

it("edits only the current inquiry when imported records are combined into the row", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { phone: "4165550123", call_status: "not_called", duplicate_count: 3, duplicate_ids: ["lead-0", "lead-0-repeat", "imported-2025"], workflow_ids: ["lead-0", "lead-0-repeat"] });
  await render([lead], "rf_transparent", { respond: panelResponder(() => lead) });
  await openLead("Customer 0");
  const requested = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(requested.some((url) => url.includes("lead_ids=lead-0%2Clead-0-repeat%2Cimported-2025"))).toBe(true);
  await act(async () => panelButton("Mark as called").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ ids: ["lead-0", "lead-0-repeat"] })]);
});

it("can undo a mistaken called mark, but not a call backed by a phone record", async () => {
  const [marked] = makeLeads(1);
  Object.assign(marked, { phone: "4165550123", call_status: "called", call_status_source: "manual", call_status_changed_by: "employee@example.com" });
  await render([marked], "rf_transparent", { respond: panelResponder(() => marked) });
  await openLead("Customer 0");
  await act(async () => panelButton("Undo called mark").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ ids: ["lead-0"], call_status: "not_called" })]);

  await act(async () => root.unmount());
  root = createRoot(container);
  const [recorded] = makeLeads(1);
  Object.assign(recorded, { phone: "4165550123", call_status: "called", last_call_at: "2026-10-26T14:00:00Z", last_called_by: "Extension 212" });
  await render([recorded], "rf_transparent", { respond: panelResponder(() => recorded) });
  await openLead("Customer 0");
  expect(panelButton("Undo called mark")).toBeUndefined();
  expect(panelButton("Called (phone record)").disabled).toBe(true);
});

it("keeps a customer with a recent repeat request in the 30-day queue", async () => {
  const leads = makeLeads(2);
  leads[0].submitted_at = new Date(NOW - 40 * DAY_MS).toISOString();
  leads[0].last_submitted_at = new Date(NOW - 5 * DAY_MS).toISOString();
  leads[1].submitted_at = new Date(NOW - 10 * DAY_MS).toISOString();
  await render(leads, "rf_transparent");
  const rows = leadRows();
  expect(rows.map((row) => row.textContent?.match(/Customer \d/)?.[0])).toEqual(["Customer 0", "Customer 1"]);
  expect(rows[0].textContent).toContain("Repeat request");
});

it("moves a Quoted lead back to Contacted when its quote is removed", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { phone: "4165550123", call_status: "called", outcome: "quoted", quote_number: "D-1042" });
  await render([lead], "rf_transparent", { respond: panelResponder(() => lead) });
  await openLead("Customer 0");
  await act(async () => panelButton("Edit").click());
  const quoteInput = container.querySelector<HTMLInputElement>('[role="dialog"] input[placeholder^="Quote / draft order"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(quoteInput, "");
    quoteInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => panelButton("Save").click());
  expect(patchBodies()).toEqual([expect.objectContaining({ quote_number: null, outcome: "contacted" })]);
});

it("shows a coworker's saved note after a refresh while the box is not being edited", async () => {
  let lead = { ...makeLeads(1)[0], notes: "Left a voicemail" } as Lead;
  await render([lead], "rf_transparent", { respond: panelResponder(() => lead) });
  await openLead("Customer 0");
  const notes = () => container.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea[placeholder="Internal notes"]')!;
  expect(notes().value).toBe("Left a voicemail");
  lead = { ...lead, notes: "Customer asked for a call Friday" };
  const refresh = [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh")!;
  await act(async () => refresh.click());
  await settle();
  expect(notes().value).toBe("Customer asked for a call Friday");
});

it("lists missed calls from the customer separately from staff calls", async () => {
  const [lead] = makeLeads(1);
  Object.assign(lead, { phone: "4165550123", call_status: "not_called" });
  await render([lead], "rf_transparent", {
    respond: panelResponder(() => lead, (url) => url.includes("view=missed_calls")
      ? { calls: [{ id: "vm-1", called_at: "2026-10-26T15:00:00Z", store_id: "rf_transparent", voicemail: true }] }
      : undefined),
  });
  await openLead("Customer 0");
  const section = container.querySelector('[aria-label="Missed calls from this customer"]')!;
  expect(section.textContent).toContain("Went to voicemail");
  expect(container.textContent).toContain("0 calls");
});
