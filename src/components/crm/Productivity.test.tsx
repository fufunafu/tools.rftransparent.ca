// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RecordDetail from "./RecordDetail";
import TaskTable from "./TaskTable";
import RecordForm from "./RecordForm";
import GlobalSearch from "./GlobalSearch";
import CrmReports from "./CrmReports";
import type { CrmRecord } from "@/lib/crm/types";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (node: ReactNode) => act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>));
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const buttons = () => [...document.querySelectorAll("button")];
const button = (text: string) => buttons().find(item => item.textContent?.trim() === text);
const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

const note: CrmRecord = { id: "tools:11111111-1111-4111-8111-111111111111", object_type: "notes", source: "tools", portal_id: null, hubspot_id: null, title: "Measured the balcony", summary: "", owner_email: "rep@example.com", created_by_email: "rep@example.com", occurred_at: "2026-10-20T15:00:00Z", effective_due_at: null, effective_task_status: null, archived: false, version: 3, view_fields: { preview: "Balcony is 12 ft" }, local_fields: {} };
const contact: CrmRecord = { ...note, id: "hubspot:1:contacts:9", object_type: "contacts", source: "hubspot", portal_id: "1", hubspot_id: "9", title: "Jordan Lee", created_by_email: null, view_fields: { email: "jordan@example.com", phone: "416-555-0100" } };

function server(record: CrmRecord, extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const handled = extra(url, init);
    if (handled) return handled;
    if (url.startsWith("/api/crm/associations")) return Response.json({ records: [], summary: null, pinned: null, labels: {} });
    if (url.startsWith("/api/crm/actions")) return Response.json({ saved: true, version: record.version + 1 });
    if (new URL(url, "http://localhost").searchParams.has("related")) return Response.json({ records: [], total: 0, page: 0 });
    return Response.json(record);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("offers Edit and Delete on a Tools note to its author, and nothing to another rep", async () => {
  server(note);
  await render(<RecordDetail id={note.id} email="rep@example.com" canManage={false} onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={() => {}} />);
  expect(button("Edit")).toBeTruthy(); expect(button("Delete")).toBeTruthy();
  await act(async () => root.unmount()); root = createRoot(container);
  await render(<RecordDetail id={note.id} email="other@example.com" canManage={false} onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={() => {}} />);
  expect(button("Edit")).toBeUndefined(); expect(button("Delete")).toBeUndefined();
});

it("asks for confirmation before deleting and sends the record version", async () => {
  const fetcher = server(contact);
  const changed = vi.fn();
  await render(<RecordDetail id={contact.id} email="boss@example.com" canManage onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={changed} />);
  await act(async () => button("Delete")!.click());
  expect(document.body.textContent).toContain("Delete this contact?");
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith("/api/crm/actions"))).toBe(false);
  await act(async () => button("Delete contact")!.click());
  const call = fetcher.mock.calls.find(([url]) => String(url).startsWith("/api/crm/actions"))!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({ action: "delete", id: contact.id, version: 3 });
  expect(changed).toHaveBeenCalled();
});

it("shows click-to-call and email links on a contact", async () => {
  server(contact);
  await render(<RecordDetail id={contact.id} email="rep@example.com" canManage={false} onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={() => {}} />);
  expect(document.querySelector('a[href="mailto:jordan@example.com"]')).toBeTruthy();
  expect(document.querySelector('a[href="tel:4165550100"]')).toBeTruthy();
});

it("lists the customer each task is about, flags overdue tasks, and completes in one click", async () => {
  const task: CrmRecord = { ...note, id: "tools:22222222-2222-4222-8222-222222222222", object_type: "tasks", title: "Send revised quote", effective_due_at: "2020-01-01T15:00:00Z", effective_task_status: "open", local_fields: { priority: "high" } };
  const othersTask: CrmRecord = { ...task, id: "tools:33333333-3333-4333-8333-333333333333", owner_email: "other@example.com", title: "Someone else's task" };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.startsWith("/api/crm/associations") || !init
    ? Response.json({ labels: { [task.id]: [{ id: contact.id, title: "Jordan Lee", object_type: "contacts" }] } })
    : Response.json({ saved: true, version: 4 }));
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  await render(<TaskTable records={[task, othersTask]} email="rep@example.com" canManage={false} onSelect={() => {}} onChanged={changed} />);
  await wait(0);
  expect(container.textContent).toContain("Jordan Lee");
  expect(container.textContent).toContain("High priority");
  expect(container.textContent).toContain("Overdue");
  const boxes = [...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
  expect(boxes[1].disabled).toBe(true);
  await act(async () => boxes[0].click());
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(String(patch[1]!.body))).toMatchObject({ id: task.id, version: 3, status: "completed", dueAt: "2020-01-01T15:00:00Z" });
  expect(changed).toHaveBeenCalled();
});

it("warns about a possible duplicate contact and opens the existing one", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/crm/search")
    ? Response.json({ matches: [{ id: contact.id, title: "Jordan Lee", object_type: "contacts", reason: "email", detail: "jordan@example.com" }] })
    : Response.json({ staff: [{ email: "rep@example.com", name: "Rep", department: "sales" }] })));
  const open = vi.fn();
  await render(<RecordForm type="contacts" related={null} email="rep@example.com" onClose={() => {}} onSaved={() => {}} onOpenExisting={open} />);
  await type(document.querySelector<HTMLInputElement>('input[name="email"]')!, "jordan@example.com");
  await wait(650);
  expect(document.body.textContent).toContain("may already exist");
  await act(async () => button("Open existing")!.click());
  expect(open).toHaveBeenCalledWith(contact.id);
});

it("opens CRM search with the slash key and opens a result with Enter", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ contacts: [contact], companies: [], tasks: [] })));
  const select = vi.fn();
  await render(<GlobalSearch onSelect={select} />);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" })); });
  const input = document.querySelector<HTMLInputElement>('dialog input[type="search"]')!;
  expect(input).toBeTruthy();
  await type(input, "jordan");
  await wait(350);
  expect(document.body.textContent).toContain("Jordan Lee");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(select).toHaveBeenCalledWith(contact.id);
});

it("shows each person's activity with team totals", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ start: "2026-10-26T04:00:00Z", end: "2026-10-29T04:00:00Z",
    people: [{ owner: "rep@example.com", name: "Riley Rep", calls: 4, emails: 2, meetings: 1, notes: 0, contacts: 3, tasks_completed: 5, tasks_overdue: 1 },
      { owner: "other@example.com", name: "Sam Sales", calls: 6, emails: 0, meetings: 0, notes: 2, contacts: 1, tasks_completed: 0, tasks_overdue: 0 }],
    stages: [{ value: "lead", label: "", count: 40 }, { value: "customer", label: "", count: 10 }] })));
  await render(<CrmReports email="rep@example.com" />);
  await wait(0);
  const rows = [...container.querySelectorAll("tbody tr")].map(row => row.textContent);
  expect(rows[0]).toContain("Riley Rep"); expect(rows[0]).toContain("(you)");
  expect(container.querySelector("tfoot")?.textContent).toContain("10");
  expect(container.textContent).toContain("Lead"); expect(container.textContent).toContain("50 total");
});

it("saves an unassigned imported task without claiming it, and skips an unchanged schedule", async () => {
  const task: CrmRecord = { ...note, id: "hubspot:1:tasks:5", object_type: "tasks", source: "hubspot", portal_id: "1", hubspot_id: "5", title: "Imported task", owner_email: null, created_by_email: null, effective_due_at: "2030-01-01T15:00:00+00:00", effective_task_status: "open", body: "", local_fields: {} };
  const fetcher = server(task, url => url.startsWith("/api/crm/staff") ? Response.json({ staff: [{ email: "boss@example.com", name: "Boss", department: "management" }] }) : undefined);
  await render(<RecordDetail id={task.id} email="boss@example.com" canManage onSelect={() => {}} onAdd={() => {}} onClose={() => {}} onChanged={() => {}} />);
  const priority = document.querySelector<HTMLSelectElement>('select[name="priority"]')!;
  await act(async () => { priority.value = "high"; priority.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("Update task")!.click());
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  const call = fetcher.mock.calls.find(([url]) => String(url).startsWith("/api/crm/actions"))!;
  const body = JSON.parse(String(call[1]!.body));
  expect(body).toMatchObject({ action: "editTask", details: { priority: "high" } });
  expect(body).not.toHaveProperty("ownerEmail");
});
