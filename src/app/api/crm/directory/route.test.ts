import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn(), delete: vi.fn(), result: { data: [] as unknown[], error: null as unknown, count: 0 } }));
vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/lib/crm/access", () => ({ canAccessCrm: mocks.access }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
import { GET, POST, DELETE } from "./route";
import { defaultColumns } from "@/lib/crm/directory-workflows";
import { emptyDirectoryFilters } from "@/lib/crm/directory";
const base = "https://tools.rftransparent.ca/api/crm/directory";
const request = (body: unknown, method = "POST", origin = "https://tools.rftransparent.ca") => new Request(base, { method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const bulk = { requestId: "11111111-1111-4111-8111-111111111111", type: "contacts", records: [{ id: "hubspot:1:contacts:1", version: 2 }], change: { kind: "owner", value: "new@example.com" } };
const view = { id: bulk.requestId, version: 0, type: "contacts", name: "Ontario", config: { search: "", filters: { ...emptyDirectoryFilters(), region: ["ontario"] }, sort: "name_asc", source: "", mine: false, archived: false, recent: false, followup: "overdue", columns: defaultColumns("contacts") } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ email: "Rep@Example.com" }); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: { updated: 1 }, error: null });
  mocks.result = { data: [], error: null, count: 0 };
  const query = { ...mocks, then: (resolve: (value: unknown) => void) => resolve(mocks.result) };
  for (const method of [mocks.from, mocks.select, mocks.eq, mocks.in, mocks.order, mocks.range, mocks.delete]) method.mockReturnValue(query);
});
it("requires CRM access for every method before reading or writing", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET(new Request(`${base}?type=contacts`))).status).toBe(401);
  expect((await POST(request({ action: "applyBulk", bulk }))).status).toBe(401);
  expect((await DELETE(request({ id: view.id, version: 1 }, "DELETE"))).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ email: "rep@example.com" }); mocks.access.mockResolvedValue(false);
  expect((await POST(request({ action: "applyBulk", bulk }))).status).toBe(403);
});
it("scopes saved views and deletions to the authenticated owner", async () => {
  const response = await GET(new Request(`${base}?type=contacts&owner=other@example.com`));
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.eq).toHaveBeenCalledWith("owner_email", "rep@example.com");
  expect((await POST(request({ action: "saveView", view }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("crm_save_view", expect.objectContaining({ p_actor: "rep@example.com", p_config: view.config, p_version: 0 }));
  mocks.result.data = [{ id: view.id }];
  expect((await DELETE(request({ id: view.id, version: 1 }, "DELETE"))).status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith("version", 1);
});
it("returns a read-only preview, rejects stale selections, and derives the apply actor from the session", async () => {
  mocks.result.data = [{ id: bulk.records[0].id, object_type: "contacts", version: 2, title: "Customer", owner_email: "original@example.com", local_fields: { owner_email: "edited@example.com" } }];
  const preview = await POST(request({ action: "previewBulk", bulk }));
  expect(preview.status).toBe(200); expect((await preview.json()).records[0].owner_email).toBe("edited@example.com"); expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await POST(request({ action: "applyBulk", bulk }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("crm_bulk_directory_action", { p_id: bulk.requestId, p_payload: bulk, p_actor: "rep@example.com" });
  mocks.result.data = [{ id: bulk.records[0].id, version: 3 }];
  expect((await POST(request({ action: "previewBulk", bulk }))).status).toBe(409);
});
it("rejects forged actors, duplicate or oversized selections, invalid views, and cross-origin writes", async () => {
  expect((await POST(request({ action: "applyBulk", bulk: { ...bulk, actor: "other@example.com" } }))).status).toBe(400);
  expect((await POST(request({ action: "applyBulk", bulk: { ...bulk, records: [bulk.records[0], bulk.records[0]] } }))).status).toBe(400);
  expect((await POST(request({ action: "applyBulk", bulk: { ...bulk, records: Array.from({ length: 51 }, (_, index) => ({ id: `hubspot:1:contacts:${index}`, version: 1 })) } }))).status).toBe(400);
  expect((await POST(request({ action: "saveView", view: { ...view, config: { ...view.config, columns: ["properties"] } } }))).status).toBe(400);
  expect((await POST(request({ action: "applyBulk", bulk }, "POST", "https://outside.example"))).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("loads paginated change history without exposing raw HubSpot properties", async () => {
  mocks.result = { data: [{ id: 1, actor_email: "rep@example.com", action: "record_updated", detail: {}, created_at: "2026-01-01" }], error: null, count: 26 };
  const response = await GET(new Request(`${base}?history=hubspot:1:contacts:1&page=1`));
  expect(response.status).toBe(200); expect((await response.json()).total).toBe(26);
  expect(mocks.range).toHaveBeenCalledWith(25, 49); expect(mocks.select).toHaveBeenCalledWith("id,actor_email,action,detail,created_at", { count: "exact" });
});
