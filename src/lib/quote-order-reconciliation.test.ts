import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), graphql: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ from: mocks.from }) }));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: mocks.graphql }));
import { confirmedQuoteOrder, reconcileQuoteOrders, type CompletedQuote } from "./quote-order-reconciliation";
const draft: CompletedQuote = { id: "gid://shopify/DraftOrder/1", status: "COMPLETED", order: { id: "gid://shopify/Order/2", createdAt: "2026-10-27T15:00:00Z", cancelledAt: null, test: false, displayFinancialStatus: "PAID" } };
beforeEach(() => vi.clearAllMocks());
it("requires a direct paid order and ignores missing, cancelled, test, pending and fully refunded purchases", () => {
  expect(confirmedQuoteOrder(draft)?.id).toBe(draft.order!.id);
  expect(confirmedQuoteOrder(null)).toBeNull();
  expect(confirmedQuoteOrder({ ...draft, order: null })).toBeNull();
  expect(confirmedQuoteOrder({ ...draft, status: "INVOICE_SENT" })).toBeNull();
  for (const overrides of [{ cancelledAt: "2026-10-27T16:00:00Z" }, { test: true }, { displayFinancialStatus: "PENDING" }, { displayFinancialStatus: "REFUNDED" }]) {
    expect(confirmedQuoteOrder({ ...draft, order: { ...draft.order!, ...overrides } })).toBeNull();
  }
});
function chain(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "is", "not", "order", "range", "update", "insert"]) builder[name] = vi.fn(() => builder);
  builder.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
  return builder;
}
it("closes only a confirmed quote and records its exact order while preserving concurrent edits", async () => {
  const read = chain({ data: [{ id: "q1", shopify_draft_id: draft.id, lead_status: "new", updated_at: "before" }, { id: "q2", shopify_draft_id: "missing", lead_status: "new", updated_at: "before" }], error: null });
  const update = chain({ data: [{ id: "q1" }], error: null });
  const log = chain({ error: null });
  mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(update).mockReturnValueOnce(log);
  mocks.graphql.mockResolvedValue({ nodes: [draft, null] });
  expect(await reconcileQuoteOrders("store2")).toEqual({ scanned: 2, won: 1, missing: 1, errors: 0 });
  expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ shopify_status: "COMPLETED", lead_status: "won", closed_at: draft.order!.createdAt, next_followup_at: null }));
  expect(update.eq).toHaveBeenCalledWith("updated_at", "before");
  expect(log.insert).toHaveBeenCalledWith(expect.objectContaining({ notes: expect.stringContaining(draft.order!.id) }));
});
it("does not log or count a win if staff changed the quote since the read", async () => {
  mocks.from.mockReturnValueOnce(chain({ data: [{ id: "q1", shopify_draft_id: draft.id, lead_status: "new", updated_at: "before" }], error: null }))
    .mockReturnValueOnce(chain({ data: [], error: null }));
  mocks.graphql.mockResolvedValue({ nodes: [draft] });
  expect((await reconcileQuoteOrders("store2")).won).toBe(0);
  expect(mocks.from).toHaveBeenCalledTimes(2);
});
it("fails visibly instead of treating a database failure as an empty queue", async () => {
  mocks.from.mockReturnValue(chain({ data: null, error: { message: "unavailable" } }));
  await expect(reconcileQuoteOrders("store2")).rejects.toThrow("unavailable");
  expect(mocks.graphql).not.toHaveBeenCalled();
});
