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
  const source = container.querySelector<HTMLSelectElement>('select[aria-label="Filter leads by source"]')!;
  expect(source.textContent).toContain("Outreach (1)");
  await act(async () => { source.value = "outreach"; source.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(leadRows()).toHaveLength(1);
  expect(leadRows()[0].textContent).toContain("Customer 1");
});

it('retains old open leads while keeping old closed leads outside recent history', async () => {
  const leads = makeLeads(2);
  leads.forEach((lead) => { lead.submitted_at = '2025-01-01T00:00:00Z'; });
  leads[1].outcome = 'won';
  await render(leads);
  expect(leadRows()).toHaveLength(1);
  expect(leadRows()[0].textContent).toContain('Customer 0');
  expect(container.textContent).toContain('Open leads from all dates');
});
it('puts overdue work first and supports the My leads view', async () => {
  const leads = makeLeads(3);
  leads[2].next_follow_up_at = '2026-10-25T10:00:00Z';
  leads[2].assigned_to = 'employee@example.com';
  await render(leads);
  expect(leadRows()[0].textContent).toContain('Customer 2');
  const owner = container.querySelector<HTMLSelectElement>('select[aria-label="Filter leads by owner"]')!;
  await act(async () => { owner.value = 'mine'; owner.dispatchEvent(new Event('change', { bubbles: true })); });
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
  const status = container.querySelector<HTMLSelectElement>('select[aria-label="Filter leads by status"]')!;
  await act(async () => { status.value = 'spam'; status.dispatchEvent(new Event('change', { bubbles: true })); });
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
