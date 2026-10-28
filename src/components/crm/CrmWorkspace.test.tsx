// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrmPage, CrmStatus } from "@/lib/crm/types";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import CrmWorkspace from "./CrmWorkspace";

let root: Root, container: HTMLDivElement;
const initialPage = { records: [{ id: "hubspot:1:contacts:2", object_type: "contacts", title: "Server loaded customer", source: "hubspot", occurred_at: null }], total: 1, page: 0 } as CrmPage;
const initialStatus: CrmStatus = { configured: false, counts: [{ object_type: "contacts", source: "hubspot", total: 1 }], sync: null };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("uses the server records immediately without duplicate initial requests, then fetches changed tabs", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.startsWith("/api/crm/directory?") ? { views: [] } : { records: [{ ...initialPage.records[0], object_type: "companies", title: "Loaded company" }], total: 1, page: 0 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} initialPage={initialPage} initialStatus={initialStatus} />));
  expect(container.textContent).toContain("Server loaded customer");
  expect(fetcher.mock.calls.filter(([url]) => !String(url).startsWith("/api/crm/directory?"))).toHaveLength(0);
  const companies = [...container.querySelectorAll("nav button")].find(button => button.textContent === "Companies") as HTMLButtonElement;
  await act(async () => companies.click());
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("type=companies"), expect.any(Object));
  expect(container.textContent).toContain("Loaded company");
  const contacts = [...container.querySelectorAll("nav button")].find(button => button.textContent === "Contacts") as HTMLButtonElement;
  await act(async () => contacts.click());
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("type=contacts"), expect.any(Object));
});
it("retries through the API when server preload data is unavailable", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.startsWith("/api/crm/directory?") ? { views: [] } : url.includes("statusOnly") ? initialStatus : initialPage));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} />));
  expect(container.textContent).toContain("Server loaded customer");
  expect(fetcher.mock.calls.filter(([url]) => !String(url).startsWith("/api/crm/directory?"))).toHaveLength(2);
});
it("hydrates preloaded dates consistently before formatting them in the viewer's time zone", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.startsWith("/api/crm/directory?") ? { views: [] } : {})); vi.stubGlobal("fetch", fetcher);
  const records = { ...initialPage, records: [{ ...initialPage.records[0], occurred_at: "2026-10-27T12:34:00Z", last_contacted_at: "2026-10-27T12:34:00Z", followup_checked_at: "2026-10-27T12:34:00Z" }] };
  const page = <CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} initialPage={records} initialStatus={initialStatus} />;
  await act(async () => root.unmount());
  container.innerHTML = renderToString(page);
  expect(container.textContent).toContain("UTC");
  const recoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(container, page, { onRecoverableError: recoverableError }); });
  expect(recoverableError).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("UTC");
  expect(fetcher.mock.calls.filter(([url]) => !String(url).startsWith("/api/crm/directory?"))).toHaveLength(0);
});

it("keeps reminder delivery history within Tasks instead of a separate navigation section", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ records: [], total: 0, page: 0 })));
  await act(async () => root.render(<CrmWorkspace initialTab="tasks" email="rep@example.com" canManage={false} initialPage={{ records: [], total: 0, page: 0 }} initialStatus={initialStatus} />));
  expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe("Tasks");
  expect(container.querySelector("nav")?.textContent).not.toContain("reminders");
  expect(container.textContent).toContain("Task reminders and delivery history");
});

it("keeps Assigned to me while switching task views and highlights the chosen view", async () => {
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({ records: [], total: 0, page: 0 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="tasks" email="rep@example.com" canManage={false} initialPage={{ records: [], total: 0, page: 0 }} initialStatus={initialStatus} />));
  const mine = [...container.querySelectorAll("label")].find(label => label.textContent === "Assigned to me")!.querySelector("input") as HTMLInputElement;
  await act(async () => mine.click());
  const overdue = [...container.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "Overdue") as HTMLButtonElement;
  await act(async () => overdue.click());
  const request = new URL(String(fetcher.mock.calls.at(-1)![0]), "https://tools.example");
  expect(request.searchParams.get("mine")).toBe("true");
  expect(request.searchParams.get("filter")).toBe("overdue");
  expect(mine.checked).toBe(true);
  expect(overdue.getAttribute("aria-selected")).toBe("true");
  await act(async () => ([...container.querySelectorAll("button")].find(button => button.textContent === "Reset filters") as HTMLButtonElement).click());
  expect(mine.checked).toBe(false);
});

it("keeps the section and open record in the address bar so Back stays in the CRM", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.startsWith("/api/crm/directory?") ? { views: [] } : { records: [], total: 0, page: 0 })));
  window.history.replaceState(null, "", "/hubspot-dupe?section=tasks");
  await act(async () => root.render(<CrmWorkspace initialTab="tasks" email="rep@example.com" canManage={false} initialPage={{ records: [], total: 0, page: 0 }} initialStatus={initialStatus} />));
  const current = () => container.querySelector('nav [aria-current="page"]')?.textContent;
  await act(async () => ([...container.querySelectorAll("nav button")].find(button => button.textContent === "Companies") as HTMLButtonElement).click());
  expect(window.location.search).toBe("?section=companies");
  window.history.replaceState(null, "", "/hubspot-dupe?section=tasks&record=hubspot%3A1%3Acontacts%3A2");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(current()).toBe("Tasks");
  expect(container.querySelector('[aria-label="CRM records"]')).toBeNull();
  window.history.replaceState(null, "", "/hubspot-dupe?section=tasks");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(container.querySelector('[aria-label="CRM records"]')).not.toBeNull();
  window.history.replaceState(null, "", "/hubspot-dupe?section=companies");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(current()).toBe("Companies");
});

it("combines owner and location filters on the server, resets pagination, and clears individual filters", async () => {
  const options = { owner: [{ value: "rep@example.com", label: "rep@example.com", count: 75 }, { value: "", label: "", count: 12 }], stage: [{ value: "customer", label: "customer", count: 20 }], country: [], region: [], city: [{ value: "ottawa", label: "Ottawa", count: 18 }] };
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, "https://tools.example").searchParams;
    return Response.json(url.startsWith("/api/crm/directory?") ? { views: [] } : params.has("filtersOnly") ? options : { records: [{ ...initialPage.records[0], title: params.has("city") ? "Ottawa result" : "Owner result" }], total: params.has("city") ? 3 : 75, page: Number(params.get("page")) || 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="contacts" email="viewer@example.com" canManage={false} initialPage={{ ...initialPage, total: 75 }} initialStatus={initialStatus} />));
  const button = (text: string) => [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === text)!;
  await act(async () => button("Next").click());
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=1");
  const owner = container.querySelector('[aria-label="Contact filters"] button') as HTMLButtonElement;
  await act(async () => owner.click());
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain("filtersOnly=true&type=contacts");
  await act(async () => (container.querySelector('[role="dialog"] input[type="checkbox"]') as HTMLInputElement).click());
  let request = new URL(fetcher.mock.calls.at(-1)![0], "https://tools.example");
  expect(request.searchParams.get("owner")).toBe("rep@example.com");
  expect(request.searchParams.get("page")).toBe("0");
  await act(async () => button("Done").click());
  const city = [...container.querySelectorAll('[aria-label="Contact filters"] button')].find(item => item.textContent?.startsWith("City")) as HTMLButtonElement;
  await act(async () => city.click());
  await act(async () => (container.querySelector('[role="dialog"] input[type="checkbox"]') as HTMLInputElement).click());
  request = new URL(fetcher.mock.calls.at(-1)![0], "https://tools.example");
  expect(request.searchParams.getAll("owner")).toEqual(["rep@example.com"]);
  expect(request.searchParams.getAll("city")).toEqual(["ottawa"]);
  expect(container.textContent).toContain("3 matches");
  expect(container.textContent).toContain("Ottawa result");
  await act(async () => (container.querySelector('[aria-label^="Remove owner filter"]') as HTMLButtonElement).click());
  request = new URL(fetcher.mock.calls.at(-1)![0], "https://tools.example");
  expect(request.searchParams.has("owner")).toBe(false);
  expect(request.searchParams.get("city")).toBe("ottawa");
  await act(async () => button("Clear all filters").click());
  expect(container.querySelector('[aria-label="Active filters"]')).toBeNull();
});
