// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CrmRecord } from "@/lib/crm/types";
import { emptyDirectoryFilters } from "@/lib/crm/directory";
import { defaultColumns, type DirectoryViewConfig } from "@/lib/crm/directory-workflows";
import DirectoryViews from "./DirectoryViews";
import DirectoryTable from "./DirectoryTable";
import DirectoryEditor from "./DirectoryEditor";
import RecordPreview from "./RecordPreview";

let root: Root, container: HTMLDivElement;
const record: CrmRecord = { id: "hubspot:1:contacts:1", object_type: "contacts", source: "hubspot", portal_id: "1", hubspot_id: "1", title: "Example Customer", summary: "", owner_email: "rep@example.com", occurred_at: "2026-01-01T12:00:00Z", effective_due_at: null, effective_task_status: null, archived: false, version: 1, created_by_email: null, view_fields: { email: "customer@example.com", stage: "lead" }, followup_checked_at: "2026-01-02T12:00:00Z", open_task_count: 0 };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
async function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
async function render(content: React.ReactNode) { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{content}</SWRConfig>)); }

it("saves filters, sorting, and reordered columns and restores the saved view", async () => {
  const config: DirectoryViewConfig = { search: "Builder", filters: { ...emptyDirectoryFilters(), region: ["ontario"] }, sort: "name_asc", source: "hubspot", mine: false, archived: false, recent: false, followup: "overdue", columns: defaultColumns("contacts") };
  const saved: unknown[] = []; const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { const input = JSON.parse(String(init.body)); writes.push(input); saved.push({ ...input.view, object_type: "contacts", version: 1 }); return Response.json({ saved: true }); }
    return Response.json({ views: saved });
  }));
  function Harness() { const [value, setConfig] = useState(config); return <><DirectoryViews type="contacts" config={value} onApply={setConfig} onColumns={columns => setConfig({ ...value, columns })} /><output>{JSON.stringify(value)}</output></>; }
  await render(<Harness />);
  const phone = [...container.querySelectorAll("label")].find(item => item.textContent?.trim() === "Phone")!.querySelector("input")!;
  await act(async () => phone.click());
  await act(async () => button("Save view").click());
  await setValue(container.querySelector('input[placeholder="For example, Ontario customers"]')!, "Ontario follow-ups");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "saveView", view: { name: "Ontario follow-ups", config: { ...config, columns: [...config.columns, "phone"] } } });
  expect(container.textContent).not.toContain("Modified");
  await act(async () => phone.click());
  expect(container.textContent).toContain("Modified");
  await setValue(container.querySelector('[aria-label="Saved views"]')!, "");
  const id = (writes[0].view as { id: string }).id;
  await setValue(container.querySelector('[aria-label="Saved views"]')!, id);
  expect(container.querySelector("output")?.textContent).toContain('"phone"');
  expect(container.textContent).not.toContain("Modified");
});
it("requires a fresh preview before applying a bulk change and keeps retry IDs stable", async () => {
  const requests: { action: string; bulk: { requestId: string } }[] = [];
  let attempts = 0; const saved = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (body.action === "previewBulk") return Response.json({ records: [record] });
    if (++attempts === 1) throw new Error("Connection interrupted");
    return Response.json({ updated: 1 });
  }));
  await render(<DirectoryTable type="contacts" records={[record]} columns={defaultColumns("contacts")} email="rep@example.com" busy={false} onSelect={() => {}} onPreview={() => {}} onChanged={saved} />);
  expect(container.textContent).toContain("Never"); expect(container.textContent).toContain("No open task");
  await act(async () => (container.querySelector('[aria-label="Select Example Customer"]') as HTMLInputElement).click());
  await act(async () => button("Update selected").click());
  await setValue(container.querySelector('input[name="value"]')!, "next@example.com");
  expect(requests).toHaveLength(0);
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(requests.map(request => request.action)).toEqual(["previewBulk"]);
  await act(async () => button("Apply to 1 records").click());
  expect(container.textContent).toContain("Connection interrupted"); expect(saved).not.toHaveBeenCalled();
  await act(async () => button("Apply to 1 records").click());
  expect(requests[1].bulk.requestId).toBe(requests[2].bulk.requestId); expect(saved).toHaveBeenCalledWith(1);
  expect(container.querySelector('[aria-label="Selected records"]')).toBeNull();
});
it("loads original company address fields before editing and submits an optimistic Tools edit", async () => {
  const company = { ...record, id: "hubspot:1:companies:1", object_type: "companies" as const, title: "Example Company", view_fields: { domain: "example.com" }, properties: { address: "123 Existing St", website: "https://example.com", zip: "A1A 1A1" } };
  const writes: unknown[] = [], saved = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); return Response.json({ saved: true }); } return Response.json(company); }));
  await render(<DirectoryEditor record={company} onClose={() => {}} onSaved={saved} />);
  expect((container.querySelector('input[name="address"]') as HTMLInputElement).value).toBe("123 Existing St");
  await setValue(container.querySelector('input[name="owner_email"]')!, "next@example.com");
  await setValue(container.querySelector('input[name="address"]')!, "456 Updated St");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes).toEqual([expect.objectContaining({ action: "editRecord", id: company.id, version: 1, fields: { address: "456 Updated St", owner_email: "next@example.com" } })]);
  expect(saved).toHaveBeenCalledOnce();
});
it("opens a nonmodal preview alongside the table and shows recent activity", async () => {
  const open = vi.fn(), close = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("related=") ? { records: [{ ...record, id: "hubspot:1:emails:1", object_type: "emails", title: "Latest customer email" }], total: 1, page: 0 } : record)));
  await render(<><table aria-label="Background records"><tbody><tr><td>Keep this table visible</td></tr></tbody></table><RecordPreview record={record} onClose={close} onOpen={open} onAdd={() => {}} onChanged={() => {}} /></>);
  expect(container.querySelector("table")).not.toBeNull(); expect(container.querySelector("dialog")?.open).toBe(true);
  expect(container.textContent).toContain("Latest customer email");
  await act(async () => button("Open full record").click()); expect(open).toHaveBeenCalledWith(record.id);
  await act(async () => (container.querySelector('[aria-label="Close preview"]') as HTMLButtonElement).click()); expect(close).toHaveBeenCalledOnce();
});
it("saves nothing when the edit form is submitted unchanged", async () => {
  const writes: unknown[] = [], close = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method === "PATCH") writes.push(init.body); return Response.json(record); }));
  await render(<DirectoryEditor record={record} onClose={close} onSaved={() => {}} />);
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes).toHaveLength(0); expect(close).toHaveBeenCalledOnce();
});
