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
  const fetcher = vi.fn(async () => Response.json({ records: [{ ...initialPage.records[0], object_type: "companies", title: "Loaded company" }], total: 1, page: 0 }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} initialPage={initialPage} initialStatus={initialStatus} />));
  expect(container.textContent).toContain("Server loaded customer");
  expect(fetcher).not.toHaveBeenCalled();
  const companies = [...container.querySelectorAll("nav button")].find(button => button.textContent === "Companies") as HTMLButtonElement;
  await act(async () => companies.click());
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("type=companies"), expect.any(Object));
  expect(container.textContent).toContain("Loaded company");
  const contacts = [...container.querySelectorAll("nav button")].find(button => button.textContent === "Contacts") as HTMLButtonElement;
  await act(async () => contacts.click());
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("type=contacts"), expect.any(Object));
});
it("retries through the API when server preload data is unavailable", async () => {
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("statusOnly") ? initialStatus : initialPage));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} />));
  expect(container.textContent).toContain("Server loaded customer");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("hydrates preloaded dates consistently before formatting them in the viewer's time zone", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const records = { ...initialPage, records: [{ ...initialPage.records[0], occurred_at: "2026-10-27T12:34:00Z" }] };
  const page = <CrmWorkspace initialTab="contacts" email="rep@example.com" canManage={false} initialPage={records} initialStatus={initialStatus} />;
  await act(async () => root.unmount());
  container.innerHTML = renderToString(page);
  expect(container.textContent).toContain("UTC");
  const recoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(container, page, { onRecoverableError: recoverableError }); });
  expect(recoverableError).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("UTC");
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps reminder delivery history within Tasks instead of a separate navigation section", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ records: [], total: 0, page: 0 })));
  await act(async () => root.render(<CrmWorkspace initialTab="tasks" email="rep@example.com" canManage={false} initialPage={{ records: [], total: 0, page: 0 }} initialStatus={initialStatus} />));
  expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe("Tasks");
  expect(container.querySelector("nav")?.textContent).not.toContain("reminders");
  expect(container.textContent).toContain("Task reminders and delivery history");
});
