import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => mock }));
import { getCrmHome } from "./home";
import { homeWindow } from "./home-window";

const now = new Date("2026-10-27T16:00:00Z");
const queries: Record<string, ReturnType<typeof vi.fn>>[] = [];
const replies: { data?: unknown[]; count?: number; error?: object }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0; replies.length = 0;
  mock.from.mockImplementation(() => {
    const index = queries.length;
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "in", "gte", "lt", "lte", "order", "limit"]) query[method] = vi.fn(() => query);
    query.then = vi.fn(resolve => resolve(replies[index] ?? { data: [], count: 0 }));
    queries.push(query); return query;
  });
});
it("uses local days and Monday weeks across daylight saving boundaries", () => {
  expect(homeWindow(new Date("2026-11-01T16:00:00Z"), "America/Toronto")).toEqual({ dayStart: "2026-11-01T04:00:00.000Z", dayEnd: "2026-11-02T05:00:00.000Z", weekStart: "2026-10-26T04:00:00.000Z" });
  expect(homeWindow(new Date("2026-03-08T16:00:00Z"), "America/Toronto")).toMatchObject({ dayStart: "2026-03-08T05:00:00.000Z", dayEnd: "2026-03-09T04:00:00.000Z" });
  expect(homeWindow(new Date("2026-10-26T02:00:00Z"), "America/Vancouver").weekStart).toBe("2026-10-19T07:00:00.000Z");
});
it("scopes every query to the authenticated owner, excludes archives and limits summary payloads", async () => {
  replies[0] = { data: [{ title: "Source", local_fields: { title: "Edited locally" } }], count: 18 };
  replies[2] = { count: 40 };
  replies[6] = { count: 76 };
  const home = await getCrmHome("Rep@Example.com", new URLSearchParams(), now);
  expect(home.tasks.openTotal).toBe(18); expect(home.tasks.open[0].title).toBe("Edited locally");
  expect(home.tasks.overdue).toBe(40); expect(home.metrics.contacts).toBe(76);
  // Contacts honour owners reassigned in Tools through the directory view.
  expect(mock.from.mock.calls.map(([table]) => table)).toEqual(["crm_records", "crm_records", "crm_records", "crm_records", "crm_records", "crm_directory", "crm_directory", "crm_records", "crm_records"]);
  for (const [index, query] of queries.entries()) {
    expect(query.eq).toHaveBeenCalledWith([5, 6].includes(index) ? "filter_owner" : "owner_email", "rep@example.com");
    expect(query.eq).toHaveBeenCalledWith("archived", false);
    expect(query.select.mock.calls[0][0]).not.toMatch(/\b(body|properties|property_history)\b/);
  }
  expect(queries[0].limit).toHaveBeenCalledWith(8);
  expect(queries[0].gte).toHaveBeenCalledWith("effective_due_at", home.dayStart);
  expect(queries[1].eq).toHaveBeenCalledWith("effective_task_status", "completed");
  expect(queries[2].lt).toHaveBeenCalledWith("effective_due_at", home.dayStart);
  expect(queries[4].limit).toHaveBeenCalledWith(15);
  expect(queries[4].select.mock.calls[0][1]).toEqual({});
  expect(queries[4].lte).toHaveBeenCalledWith("occurred_at", now.toISOString());
  expect(queries[6].select).toHaveBeenCalledWith("id", { count: "exact", head: true });
  expect(queries[6].gte).toHaveBeenCalledWith("occurred_at", home.weekStart);
});
it("reads Team without an owner filter and filters activity at the database", async () => {
  await getCrmHome("rep@example.com", new URLSearchParams("scope=team&activity=calls&timeZone=America/Vancouver"), now);
  for (const query of queries) expect(query.eq.mock.calls.some(([key]) => key === "owner_email" || key === "filter_owner")).toBe(false);
  expect(queries[4].in).toHaveBeenCalledWith("object_type", ["calls"]);
});
it("rejects invalid views and never reports failed queries as zero metrics", async () => {
  for (const params of ["scope=somebody", "activity=deals", "timeZone=not-a-zone"]) await expect(getCrmHome("rep@example.com", new URLSearchParams(params), now)).rejects.toThrow(/Invalid/);
  expect(mock.from).not.toHaveBeenCalled();
  replies[7] = { error: { message: "Database unavailable" } };
  await expect(getCrmHome("rep@example.com", new URLSearchParams(), now)).rejects.toThrow("Home could not load");
});
