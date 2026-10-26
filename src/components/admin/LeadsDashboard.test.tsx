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
    outcome: null,
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

async function render(leads: Lead[]) {
  // The API serves the same list the server rendered, so a repeat download
  // would not change what the table shows.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ leads }))));
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <LeadsDashboard
          initialLeads={leads}
          initialNow={NOW}
          initialBounds={BOUNDS}
          store="bc_transparent"
        />
      </SWRConfig>,
    );
  });
}

beforeEach(() => {
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
