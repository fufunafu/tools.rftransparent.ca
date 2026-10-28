import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), list: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user, isManagementUser: mocks.manage }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ insert: mocks.insert }) }) }));
vi.mock("@/lib/crm/data", () => ({
  effectiveRecord: (record: unknown) => record,
  buildCrmListQuery: (params: URLSearchParams) => ({ query: { order: () => ({ range: (from: number, to: number) => mocks.list(params, from, to) }) }, page: 0 }),
}));
import { GET } from "./route";

const url = "https://tools.rftransparent.ca/api/crm/export?type=contacts&q=glass&owner=rep%40example.com";
const contact = { id: "hubspot:1:contacts:1", object_type: "contacts", source: "hubspot", title: "=HYPERLINK(\"bad\")", owner_email: "rep@example.com", view_fields: { email: "client@example.com", city: "Toronto" }, occurred_at: "2026-10-01T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ email: "Boss@Example.com" }); mocks.access.mockResolvedValue(true); mocks.manage.mockResolvedValue(true);
  mocks.list.mockResolvedValue({ data: [contact], count: 1, error: null }); mocks.insert.mockResolvedValue({ error: null });
});

describe("CRM CSV export", () => {
  it("is limited to management", async () => {
    mocks.manage.mockResolvedValue(false);
    expect((await GET(new Request(url))).status).toBe(403);
    mocks.user.mockResolvedValue(null);
    expect((await GET(new Request(url))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("logs the export with its filters, then returns a spreadsheet-safe CSV", async () => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="crm-contacts-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(mocks.insert).toHaveBeenCalledWith({ actor_email: "boss@example.com", object_type: "contacts", filters: { type: ["contacts"], q: ["glass"], owner: ["rep@example.com"] }, row_count: 1 });
    const text = await response.text();
    expect(text).toContain('"Name","Email","Phone"');
    expect(text).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(text).toContain('"client@example.com"');
  });
  it("refuses instead of truncating very large lists, and never downloads unlogged data", async () => {
    mocks.list.mockResolvedValue({ data: [contact], count: 25000, error: null });
    const tooLarge = await GET(new Request(url));
    expect(tooLarge.status).toBe(413); expect((await tooLarge.json()).error).toContain("25,000");
    mocks.list.mockResolvedValue({ data: [contact], count: 1, error: null }); mocks.insert.mockResolvedValue({ error: { code: "PGRST205" } });
    const unlogged = await GET(new Request(url));
    expect(unlogged.status).toBe(503); expect(unlogged.headers.get("content-type")).toContain("application/json");
  });
  it("refuses a file that would come out short because the list changed", async () => {
    mocks.list.mockResolvedValueOnce({ data: [contact], count: 2, error: null }).mockResolvedValueOnce({ data: [], count: 1, error: null });
    const response = await GET(new Request(url));
    expect(response.status).toBe(409); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("pages by the rows actually returned", async () => {
    mocks.list.mockResolvedValueOnce({ data: [contact], count: 2, error: null }).mockResolvedValueOnce({ data: [{ ...contact, id: "hubspot:1:contacts:2" }], count: 2, error: null });
    expect((await GET(new Request(url))).status).toBe(200);
    expect(mocks.list.mock.calls.map(call => call[1])).toEqual([0, 1]);
  });
  it("only exports Contacts or Companies", async () => {
    expect((await GET(new Request("https://tools.rftransparent.ca/api/crm/export?type=tasks"))).status).toBe(400);
  });
});
