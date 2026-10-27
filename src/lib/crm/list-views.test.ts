import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), or: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(), range: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => mock }));
import { listCrmRecords } from "./data";
beforeEach(() => { vi.resetAllMocks(); for (const fn of Object.values(mock)) fn.mockReturnValue(mock); mock.range.mockResolvedValue({ data: [], count: 0 }); });
it("separates upcoming tasks from the old overdue backlog and sorts overdue newest first", async () => {
  await listCrmRecords(new URLSearchParams("type=tasks&filter=upcoming"), "rep@example.com");
  expect(mock.gte).toHaveBeenCalledWith("effective_due_at", expect.any(String));
  expect(mock.lt).toHaveBeenCalledWith("effective_due_at", expect.any(String));
  expect(mock.order).toHaveBeenCalledWith("effective_due_at", { ascending: true, nullsFirst: false });
  mock.order.mockClear();
  await listCrmRecords(new URLSearchParams("type=tasks&filter=overdue"), "rep@example.com");
  expect(mock.eq).toHaveBeenCalledWith("effective_task_status", "open");
  expect(mock.order).toHaveBeenCalledWith("effective_due_at", { ascending: false, nullsFirst: false });
});
it("uses the viewer's exact local-day boundaries and rejects invalid ranges", async () => {
  const params = new URLSearchParams({ type: "tasks", filter: "today", dayStart: "2026-11-01T04:00:00Z", dayEnd: "2026-11-02T05:00:00Z" });
  await listCrmRecords(params, "rep@example.com");
  expect(mock.gte).toHaveBeenCalledWith("effective_due_at", params.get("dayStart"));
  expect(mock.lt).toHaveBeenCalledWith("effective_due_at", params.get("dayEnd"));
  params.set("dayEnd", "invalid"); await expect(listCrmRecords(params, "rep@example.com")).rejects.toThrow("Invalid day");
});
it("searches local contact edits and displays them without modifying source fields", async () => {
  mock.range.mockResolvedValue({ data: [{ id: "tools:test", title: "Source name", view_fields: { email: "source@example.com", phone: "4165550199" }, local_fields: { title: "Current name", email: "new@example.com" } }], count: 1 });
  const result = await listCrmRecords(new URLSearchParams("type=contacts&q=new@example.com&mine=true"), "rep@example.com");
  expect(mock.or).toHaveBeenCalledWith(expect.stringContaining("local_fields->>email.ilike."));
  expect(mock.eq).toHaveBeenCalledWith("owner_email", "rep@example.com");
  expect(result.records[0].title).toBe("Current name");
  expect(result.records[0].view_fields).toEqual({ title: "Current name", email: "new@example.com", phone: "4165550199" });
});
