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

async function render(leads: Lead[], store: Lead["store_id"] = "bc_transparent") {
  // The API serves the same list the server rendered, so a repeat download
  // would not change what the table shows.
  vi.stubGlobal("fetch", vi.fn(async (url) => new Response(JSON.stringify(String(url).includes("sync-status") ? { sources: [], canSync: false } : { leads }))));
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LeadsDashboard
          initialLeads={leads}
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
it('explains excluded spam and keeps phone numbers readable and callable', async () => {
  const leads = makeLeads(2);
  leads[0].phone = '+1 416 555 0123';
  leads[1].outcome = 'not_applicable'; leads[1].not_applicable_reason = 'Spam: marketing solicitation';
  await render(leads);
  expect(container.textContent).toContain('1 spam excluded');
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
  expect(trigger.textContent).toContain("Website, Meta");
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
