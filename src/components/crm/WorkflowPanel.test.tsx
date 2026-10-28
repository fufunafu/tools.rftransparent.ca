// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkflowPanel, { FilesPanel } from "./WorkflowPanel";
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const status = { pendingIndex: 0, contactIndexPending: 0, assets: [], capture: { enabled: true, started_at: "2026-10-27T10:00:00Z" }, captureCounts: [], remindersConfigured: true, filesConfigured: false, latestRun: null };
it("shows both duplicate records and saves only a non-destructive review decision", async () => {
  const groups = [{ kind: "email", value: "client@example.com", fingerprint: "a".repeat(32), total: 2, records: [{ id: "tools:a", title: "Customer A", summary: "" }, { id: "tools:b", title: "Customer B", summary: "" }], decision: null }];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => Response.json(options?.method === "POST" ? { saved: true } : url.includes("duplicates") ? { groups } : status));
  vi.stubGlobal("fetch", fetcher);
  const select = vi.fn();
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><WorkflowPanel view="duplicates" canManage={false} onSelect={select} /></SWRConfig>));
  expect(container.textContent).toContain("Customer A"); expect(container.textContent).toContain("Customer B");
  const keep = [...container.querySelectorAll("button")].find(button => button.textContent === "Keep separate")!;
  await act(async () => keep.click());
  const save = fetcher.mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(String(save?.[1]?.body))).toMatchObject({ action: "review_duplicate", decision: "separate" });
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
});
it("offers downloads only for verified copies and explains blocked file access", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ files: [
    { id: "hubspot:1:file:1", kind: "file", filename: "drawing.pdf", status: "ready", byte_size: 100 },
    { id: "hubspot:1:file:2", kind: "file", filename: null, status: "blocked", error_code: "hubspot_file_access" },
  ], total: 2 })));
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><FilesPanel configured={false} canManage /></SWRConfig>));
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/api/crm/files?id=hubspot%3A1%3Afile%3A1");
  expect(container.textContent).toContain("Needs HubSpot file permission");
  expect(container.textContent).toContain("Background file copying needs the HubSpot connection");
});
it("does not link activity to a contact hidden by a newer search", async () => {
  const event = { id: "11111111-1111-4111-8111-111111111111", revision: 1, kind: "calls", occurred_at: "2026-10-27T10:00:00Z", reason: "no_customer_match", payload: { direction: "inbound", from_number: "+15550000000" }, matched_ids: [], candidates: [] };
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return Response.json({ saved: true });
    if (url.includes("view=activity")) return Response.json({ events: [event], total: 1 });
    if (url.startsWith("/api/crm?type=contacts")) return Response.json({ records: url.includes("smi") ? [{ id: "tools:11111111-1111-4111-8111-111111111111", title: "John Smith", summary: "" }] : [], total: 0, page: 0 });
    return Response.json(status);
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><WorkflowPanel view="capture" canManage={false} onSelect={vi.fn()} /></SWRConfig>));
  const search = container.querySelector('input[placeholder="Search name or email"]') as HTMLInputElement;
  const type = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await type("smi");
  const select = container.querySelector("select") as HTMLSelectElement;
  await act(async () => { select.value = "tools:11111111-1111-4111-8111-111111111111"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const link = [...container.querySelectorAll("button")].find(button => button.textContent === "Link activity") as HTMLButtonElement;
  expect(link.disabled).toBe(false);
  await type("jane");
  expect(link.disabled).toBe(true);
  expect(container.textContent).not.toContain("Review this customer");
});
