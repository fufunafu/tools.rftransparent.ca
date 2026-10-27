// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProblemsDashboard from "./ProblemsDashboard";
import type { ProblemTicket } from "@/lib/problem-tickets";

vi.mock("next/dynamic", () => ({ default: () => () => <div>Chart</div> }));
const ticket: ProblemTicket = {
  id: "00000000-0000-4000-8000-000000000001", client_name: "Photo Test", ticket_date: new Date().toISOString().slice(0, 10),
  person: null, status: "in_progress", type: "broken_glass", issue: "Broken panel", resolution: null,
  store: null, created_by: "staff@example.com", created_at: "2026-09-25T12:00:00Z", updated_at: "2026-09-25T12:00:00Z", resolved_at: null,
  attachments: [],
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const fetchMock = vi.fn();
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<ProblemsDashboard stores={[]} canDelete={false} currentUserEmail="staff@example.com" />));
}
function button(text: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
}
async function choose(files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function submit() {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("keeps a newly saved ticket and only retries remaining pictures after a partial upload failure", async () => {
  fetchMock.mockResolvedValueOnce(response({ tickets: [] }));
  await render();
  await act(async () => button("New ticket").click());
  const name = container.querySelector<HTMLInputElement>('input[placeholder="e.g. David Hugh"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, ticket.client_name);
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await choose([new File(["one"], "one.png", { type: "image/png" }), new File(["two"], "two.jpg", { type: "image/jpeg" })]);
  expect(container.querySelectorAll('img[alt^="Preview"]')).toHaveLength(2);
  const uploaded = { id: "photo-one", filename: "one.png", content_type: "image/png", size_bytes: 3, uploaded_by: "staff@example.com", created_at: ticket.created_at };
  fetchMock.mockResolvedValueOnce(response({ ticket }));
  fetchMock.mockResolvedValueOnce(response({ attachment: uploaded }, 201));
  fetchMock.mockResolvedValueOnce(response({ error: "Connection interrupted" }, 500));
  await submit();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ticket saved.");
  expect(container.querySelectorAll('img[alt^="Preview"]')).toHaveLength(1);
  expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  const failedBody = fetchMock.mock.calls[3][1].body as FormData;
  const failedId = failedBody.get("id");

  fetchMock.mockResolvedValueOnce(response({ ticket: { ...ticket, attachments: [uploaded] } }));
  fetchMock.mockResolvedValueOnce(response({ attachment: { ...uploaded, id: failedId, filename: "two.jpg", content_type: "image/jpeg" } }, 201));
  await submit();
  expect(fetchMock.mock.calls[4][1].method).toBe("PATCH");
  expect((fetchMock.mock.calls[5][1].body as FormData).get("id")).toBe(failedId);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(container.textContent).toContain("2 pictures");
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("loads existing pictures, rejects oversized files and removes only the selected saved picture", async () => {
  const photo = { id: "photo-one", filename: "delivery.png", content_type: "image/png", size_bytes: 3, uploaded_by: "staff@example.com", created_at: ticket.created_at };
  fetchMock.mockResolvedValueOnce(response({ tickets: [{ ...ticket, attachments: [photo] }] }));
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="View 1 picture for Photo Test"]')!.click());
  expect(container.querySelector('a[aria-label="Open delivery.png"]')?.getAttribute("href")).toBe("/api/problems/attachments/photo-one");
  await choose([new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" })]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("4 MB");
  expect(container.querySelectorAll('img[alt^="Preview"]')).toHaveLength(0);
  vi.stubGlobal("confirm", vi.fn(() => true));
  fetchMock.mockResolvedValueOnce(response({ ok: true }));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove delivery.png"]')!.click());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/problems/attachments?id=photo-one", { method: "DELETE" });
  expect(container.querySelector('a[aria-label="Open delivery.png"]')).toBeNull();
  expect(container.querySelector("tbody")?.textContent).not.toContain("1 picture");
});
