import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_GLASS_POLICY } from "@/lib/purchasing/policy";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), from: vi.fn(), update: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isManagementUser: mocks.authorized, getAuthenticatedUser: async () => ({ email: "manager@example.test" }) }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/purchasing/queries", () => ({ getPurchasingSettings: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/purchasing/activity", async importOriginal => ({ ...await importOriginal<object>(), logActivity: mocks.log }));
import { PATCH } from "./route";
const request = (body: unknown) => new NextRequest("https://example.test/api/purchasing/settings", { method: "PATCH", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.authorized.mockResolvedValue(true);
  mocks.update.mockReturnValue({ eq: async () => ({ error: null }) });
  mocks.from.mockReturnValue({ update: mocks.update, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { glass_policy: DEFAULT_GLASS_POLICY, lead_time_days: 84 } }) }) }) });
});
it("requires management access to update policy", async () => {
  mocks.authorized.mockResolvedValue(false);
  expect((await PATCH(request({ glass_policy: DEFAULT_GLASS_POLICY }))).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("rejects incomplete policies and invalid supplier inputs without writing settings", async () => {
  for (const body of [{ glass_policy: { order_interval_days: 30 } }, { lead_time_days: 84.5 }, { lead_time_days: "84" }, { crate_size: 0 }]) expect((await PATCH(request(body))).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("persists and audits changed policy values", async () => {
  const policy = { ...DEFAULT_GLASS_POLICY, order_interval_days: 45 };
  expect((await PATCH(request({ glass_policy: policy }))).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ glass_policy: policy });
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ field: "glass_policy", old_value: JSON.stringify(DEFAULT_GLASS_POLICY), new_value: JSON.stringify(policy) }));
});
