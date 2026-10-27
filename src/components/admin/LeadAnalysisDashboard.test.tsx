// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { expect, it, vi } from "vitest";
import type { Lead } from "@/lib/customer-service/leads";
import { leadTrendQueryBounds } from "@/lib/lead-analytics";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import LeadAnalysisDashboard from "./LeadAnalysisDashboard";

it("labels source totals separately from rolling lines and shows actionable first-call buckets", async () => {
  const now = Date.parse("2026-10-27T22:00:00Z");
  const base = { store_id: "rf_transparent", source: "website", submitted_at: "2026-10-26T14:00:00Z", call_status: "not_called", phone: "4165550123", quote_number: null, outcome: "new", not_applicable_reason: null, raw_payload: {} };
  const leads = [
    { ...base, id: "on-time", first_call_at: "2026-10-26T15:00:00Z", outcome: "won" },
    { ...base, id: "missed", first_call_at: null },
    { ...base, id: "pending", source: "outreach", submitted_at: "2026-10-27T22:00:00Z", first_call_at: null },
  ] as Lead[];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ leads, tracking_started_at: "2026-09-01T00:00:00Z" }))));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><LeadAnalysisDashboard initialNow={now} initialBounds={leadTrendQueryBounds("30d", new Date(now))} initialLeads={leads} store="rf_transparent" /></SWRConfig>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const cards = [...container.querySelectorAll("article")];
    const order = cards.find(card => card.querySelector("h2")?.textContent === "Lead-to-order rate")!;
    expect(order.textContent).toContain("Website: 50%");
    expect(order.textContent).toContain("Meta: No data");
    expect(order.textContent).toContain("Outreach: 0%");
    expect(order.textContent).toContain("1/2 won");
    expect(order.textContent).toContain("Selected-period totals");
    expect(order.textContent).toContain("Lines: 7-day rolling rates");
    const call = cards.find(card => card.querySelector("h2")?.textContent === "Called on the same business day")!;
    expect(call.textContent).toContain("Website: 50%");
    expect(call.textContent).toContain("1/2 due");
    expect(call.textContent).toContain("Outreach: No data");
    expect(container.querySelector('[aria-label="Website call follow-up"] [role="img"]')?.getAttribute("aria-label")).toContain("Called on time: 1, Called late: 0, Overdue, not called: 1");
    expect(container.querySelector('[aria-label="Outreach call follow-up"] [role="img"]')?.getAttribute("aria-label")).toContain("Still within deadline: 1");
    expect(cards.some(card => card.querySelector("h2")?.textContent === "Median elapsed time to call")).toBe(false);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
