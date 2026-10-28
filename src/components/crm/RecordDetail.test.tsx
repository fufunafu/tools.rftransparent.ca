// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RecordDetail from "./RecordDetail";

let root: Root, container: HTMLDivElement;
const record = { id: "hubspot:1:contacts:2", title: "Example Customer", source: "hubspot", object_type: "contacts", portal_id: "1", hubspot_id: "2", summary: "", occurred_at: null, owner_email: null, archived: false };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("fetches and renders source fields and history only when their disclosures are opened", async () => {
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    if (url.startsWith("/api/crm/associations")) return Response.json({ records: [], summary: null, pinned: null });
    if (params.has("related")) return Response.json({ records: [], total: 0, page: 0 });
    if (params.get("view") === "fields") return Response.json({ ...record, properties: { phone: "416-555-0199" } });
    if (params.get("view") === "history") return Response.json({ ...record, property_history: { project: [{ value: "Previous railing plan" }] } });
    return Response.json({ ...record, body: "Latest conversation" });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><RecordDetail id={record.id} email="rep@example.com" canManage={false} onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={() => {}} /></SWRConfig>));
  expect(container.textContent).toContain("Latest conversation");
  expect(fetcher.mock.calls.some(([url]) => /view=(fields|history)/.test(url))).toBe(false);
  const fields = [...container.querySelectorAll("details")].find(panel => panel.querySelector("summary")?.textContent === "All saved fields")!;
  const history = [...container.querySelectorAll("details")].find(panel => panel.querySelector("summary")?.textContent === "Original property history")!;
  await act(async () => { fields.open = true; fields.dispatchEvent(new Event("toggle")); });
  expect(container.textContent).toContain("416-555-0199");
  expect(fetcher.mock.calls.some(([url]) => url.includes("view=history"))).toBe(false);
  await act(async () => { history.open = true; history.dispatchEvent(new Event("toggle")); });
  expect(container.textContent).toContain("Previous railing plan");
  await act(async () => { history.open = false; history.dispatchEvent(new Event("toggle")); });
  expect(container.querySelector("pre")).toBeNull();
});
