import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ management: vi.fn(), user: vi.fn(), rpc: vi.fn(), overview: vi.fn(), sources: vi.fn(), status: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isManagementUser: m.management, getAuthenticatedUser: m.user }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("@/lib/purchasing/sales-queries", () => ({ getSalesOverview: m.overview, getSalesSources: m.sources, getSalesStatus: m.status }));
vi.mock("next/cache", () => ({ revalidateTag: m.revalidate }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.management.mockResolvedValue(true); m.user.mockResolvedValue({ email: "Manager@example.com" }); m.rpc.mockResolvedValue({ data: true, error: null }); });
it("denies every history read and mapping write to non-management users", async () => {
  m.management.mockResolvedValue(false);
  expect((await GET(new NextRequest("https://example.com/api/purchasing/sales?sources=1"))).status).toBe(403);
  expect((await POST(new NextRequest("https://example.com/api/purchasing/sales", { method: "POST" }))).status).toBe(403);
  expect(m.sources).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects invalid conversions without changing the map", async () => {
  const response = await POST(new NextRequest("https://example.com/api/purchasing/sales", { method: "POST", body: JSON.stringify({ source_key: "a".repeat(64), product_id: null, unit_multiplier: -1 }) }));
  expect(response.status).toBe(400); expect(m.rpc).not.toHaveBeenCalled();
});
it("saves a reviewed mapping with authenticated reviewer identity", async () => {
  const response = await POST(new NextRequest("https://example.com/api/purchasing/sales", { method: "POST", body: JSON.stringify({ source_key: "a".repeat(64), product_id: "00000000-0000-4000-8000-000000000001", unit_multiplier: 2 }) }));
  expect(await response.json()).toEqual({ saved: true, published: true });
  expect(m.rpc).toHaveBeenCalledWith("purchasing_sales_review", expect.objectContaining({ p_actor: "manager@example.com", p_multiplier: 2 }));
});
