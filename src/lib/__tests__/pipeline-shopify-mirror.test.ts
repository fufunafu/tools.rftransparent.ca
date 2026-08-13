import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  getStores: vi.fn(),
  fetchAllPages: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ getSupabase: mocks.getSupabase }));
vi.mock("@/lib/shopify", () => ({
  getStores: mocks.getStores,
  fetchAllPages: mocks.fetchAllPages,
  REVENUE_FIELDS: "subtotalPriceSet { shopMoney { amount } }",
}));

import {
  loadPipelineMirror,
  pipelineMirrorHistoryStart,
  syncPipelineShopifyMirror,
} from "@/lib/pipeline-shopify-mirror";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStores.mockReturnValue([{ id: "store1", label: "Store 1" }]);
});

describe("pipeline Shopify mirror", () => {
  it("skips Shopify when every mirror watermark is fresh", async () => {
    const now = new Date();
    const historyFrom = new Date(now);
    historyFrom.setFullYear(historyFrom.getFullYear() - 2);
    const states = ["order", "draft"].map((resourceType) => ({
      store_id: "store1",
      resource_type: resourceType,
      history_from: historyFrom.toISOString(),
      last_synced_at: now.toISOString(),
    }));
    mocks.getSupabase.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(async () => ({ data: states, error: null })),
      })),
    });

    const result = await syncPipelineShopifyMirror(historyFrom);

    expect(result.skipped).toBe(true);
    expect(result.recordsSynced).toBe(0);
    expect(mocks.fetchAllPages).not.toHaveBeenCalled();
  });

  it("loads orders and drafts from a complete local mirror", async () => {
    const fromDate = new Date("2024-08-13T00:00:00Z");
    const statesBuilder = {
      select: vi.fn(),
      in: vi.fn(async () => ({
        data: [
          { store_id: "store1", resource_type: "order", history_from: fromDate.toISOString() },
          { store_id: "store1", resource_type: "draft", history_from: fromDate.toISOString() },
        ],
        error: null,
      })),
    };
    statesBuilder.select.mockReturnValue(statesBuilder);

    const order = { id: "o1", createdAt: "2026-01-01T00:00:00Z" };
    const draft = { id: "d1", createdAt: "2026-01-02T00:00:00Z" };
    const recordsBuilder = {
      select: vi.fn(),
      in: vi.fn(),
      gte: vi.fn(),
      order: vi.fn(),
      range: vi.fn(async () => ({
        data: [
          { resource_type: "order", payload: order },
          { resource_type: "draft", payload: draft },
        ],
        error: null,
      })),
    };
    recordsBuilder.select.mockReturnValue(recordsBuilder);
    recordsBuilder.in.mockReturnValue(recordsBuilder);
    recordsBuilder.gte.mockReturnValue(recordsBuilder);
    recordsBuilder.order.mockReturnValue(recordsBuilder);
    mocks.getSupabase.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "pipeline_shopify_sync_state" ? statesBuilder : recordsBuilder),
    });

    const result = await loadPipelineMirror(["store1"], fromDate);

    expect(result?.orders).toEqual([order]);
    expect(result?.drafts).toEqual([draft]);
  });

  it("uses two years of history unless the selected period starts earlier", () => {
    const recent = pipelineMirrorHistoryStart(new Date());
    expect(Date.now() - recent.getTime()).toBeGreaterThan(700 * 24 * 60 * 60 * 1000);

    const older = new Date("2020-01-01T00:00:00Z");
    expect(pipelineMirrorHistoryStart(older)).toEqual(older);
  });
});
