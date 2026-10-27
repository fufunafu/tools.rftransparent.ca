// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CrmWorkspace from "./CrmWorkspace";
import CrmHome from "./CrmHome";
import { SWRConfig } from "swr";
import { homeUrl, type CrmHomeData } from "@/lib/crm/home-window";
import type { CrmRecord } from "@/lib/crm/types";
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const contact = { portal_id: null, hubspot_id: null, summary: "", owner_email: "rep@example.com", effective_due_at: null, effective_task_status: null, archived: false, version: 1, created_by_email: "rep@example.com", id: "tools:contact", object_type: "contacts", source: "tools", title: "Example customer", occurred_at: "2026-10-27T12:00:00Z", view_fields: { stage: "lead" } } as CrmRecord;
const home: CrmHomeData = {
  asOf: "2026-10-27T16:00:00Z", timeZone: "America/Toronto", scope: "mine", dayStart: "2026-10-27T04:00:00Z", dayEnd: "2026-10-28T04:00:00Z", weekStart: "2026-10-26T04:00:00Z",
  tasks: { open: [{ ...contact, id: "tools:task", title: "Call customer", object_type: "tasks", effective_due_at: "2026-10-27T18:00:00Z" }], completed: [], openTotal: 1, completedTotal: 0, overdue: 2 },
  meetings: [], meetingTotal: 0, activities: [{ ...contact, id: "tools:email", object_type: "emails", title: "Quote sent" }], contacts: [contact], metrics: { contacts: 76, calls: 12, emails: 30 },
};
const status = { configured: true, counts: [], sync: null };
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("opens Home with preloaded data and removes Deals, Tickets and migration files from the main navigation", async () => {
  const fetcher = vi.fn(async () => Response.json(home)); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace email="rep@example.com" displayName="Robin Smith" canManage={false} initialHome={home} initialStatus={status} />));
  expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe("Home");
  const nav = container.querySelector("nav")!.textContent;
  expect(nav).toContain("Contacts"); expect(nav).toContain("Companies");
  expect(nav).not.toMatch(/Deals|Tickets|Files|recordings/);
  expect(container.textContent).toContain("Robin"); expect(container.textContent).toContain("Example customer");
  expect(container.textContent).toContain("76"); expect(container.textContent).not.toContain("pipeline");
  expect(container.querySelector("details")?.textContent).toContain("Imported attachments & call recordings");
  // Only a different browser zone should require a request after hydration.
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === home.timeZone) expect(fetcher).not.toHaveBeenCalled();
});

it("switches owner scope and activity filters through the server", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json({ ...home, scope: new URL(url, "http://localhost").searchParams.get("scope") })); vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace email="rep@example.com" canManage={false} initialHome={home} initialStatus={status} />));
  const team = [...container.querySelectorAll("button")].find(button => button.textContent === "Team")!;
  await act(async () => team.click());
  expect(fetcher.mock.calls.some(([url]) => url.includes("scope=team"))).toBe(true);
  const select = container.querySelector('select[aria-label="Activity type"]') as HTMLSelectElement;
  await act(async () => { select.value = "calls"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(fetcher.mock.calls.some(([url]) => url.includes("scope=team") && url.includes("activity=calls"))).toBe(true);
});

it("links the cards to records, the existing task form, and the correct owner queue", async () => {
  const select = vi.fn(), add = vi.fn(), navigate = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => Response.json(home)));
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), fallback: { [homeUrl(home.timeZone)]: home } }}><CrmHome email="rep@example.com" initialHome={home} onSelect={select} onAdd={add} onNavigate={navigate} /></SWRConfig>));
  const buttons = () => [...container.querySelectorAll("button")];
  await act(async () => buttons().find(button => button.textContent === "+ New task")!.click()); expect(add).toHaveBeenCalledWith("tasks");
  await act(async () => buttons().find(button => button.textContent?.includes("Example customer"))!.click()); expect(select).toHaveBeenCalledWith("tools:contact");
  await act(async () => buttons().find(button => button.textContent?.includes("Overdue tasks"))!.click()); expect(navigate).toHaveBeenCalledWith("tasks", "overdue", true);
  await act(async () => buttons().find(button => button.getAttribute("role") === "tab" && button.textContent?.startsWith("Completed"))!.click()); expect(container.textContent).toContain("No completed tasks due today");
  await act(async () => buttons().find(button => button.textContent?.includes("View all of today"))!.click()); expect(navigate).toHaveBeenCalledWith("tasks", "today", true, "completed");
});

it("hydrates the server Home without date or greeting mismatches", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(home)));
  const page = <CrmWorkspace email="rep@example.com" canManage={false} initialHome={home} initialStatus={status} />;
  await act(async () => root.unmount()); container.innerHTML = renderToString(page);
  const onRecoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(container, page, { onRecoverableError }); });
  expect(onRecoverableError).not.toHaveBeenCalled();
});
