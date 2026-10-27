import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const state = vi.hoisted(() => ({
  authenticated: true,
  count: 0,
  store: "store1",
  rpc: vi.fn(),
  write: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  getAuthenticatedUser: async () => state.authenticated ? { email: "rep@example.com" } : null,
  isAuthenticated: async () => state.authenticated,
}));
vi.mock("@/lib/shopify", () => ({ getStores: () => [{ id: "store1" }], shopifyGraphQL: vi.fn() }));
vi.mock("@/lib/customer-service/followup-queries", () => ({}));
vi.mock("@/lib/lead-quote-sync", () => ({ syncLeadQuotesFromFollowups: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({
  rpc: state.rpc,
  from: () => {
    let store: string | undefined;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === "store_id") store = value; return query; },
      single: async () => ({ data: store === state.store ? { store_id: state.store, followup_count: state.count } : null, error: null }),
      insert: state.write,
      update: state.write,
    };
    return query;
  },
}) }));

beforeEach(() => {
  state.authenticated = true;
  state.count = 0;
  state.store = "store1";
  state.write.mockReset();
  state.rpc.mockReset().mockResolvedValue({ data: { followup_count: 1 }, error: null });
});

function save(outcome = "no_answer", store = "store1") {
  return POST(new NextRequest(`https://example.test/api/customer-service/follow-up?action=log&store=${store}`, {
    method: "POST",
    body: JSON.stringify({ lead_id: "lead-1", outcome, custom_date: "2027-01-01" }),
  }));
}

it("saves RF outcomes atomically and does not forward a custom date", async () => {
  expect((await save("future_project")).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("log_rf_followup", {
    p_lead_id: "lead-1", p_expected_count: 0, p_outcome: "future_project",
    p_notes: null, p_logged_by: "rep@example.com", p_close_reason: null,
  });
  expect(state.write).not.toHaveBeenCalled();
});

it("rejects a third follow-up before any write", async () => {
  state.count = 2;
  expect((await save()).status).toBe(409);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});

it("allows recording a final outcome after both follow-ups", async () => {
  state.count = 2;
  expect((await save("lost")).status).toBe(200);
  expect(state.rpc.mock.calls[0][1].p_expected_count).toBe(2);
});

it("returns a conflict when another save wins the race", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Refresh before saving" } });
  expect((await save()).status).toBe(409);
  expect(state.write).not.toHaveBeenCalled();
});

it("cannot bypass the RF schedule by passing a different store", async () => {
  expect((await save("no_answer", "store2")).status).toBe(404);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("requires authentication", async () => {
  state.authenticated = false;
  expect((await save()).status).toBe(401);
  expect(state.rpc).not.toHaveBeenCalled();
});
