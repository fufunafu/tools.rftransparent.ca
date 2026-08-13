import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  isAuthenticated: vi.fn(),
  getStores: vi.fn(),
  getSupabase: vi.fn(),
  getPipelineDashboardData: vi.fn(),
  syncPipelineShopifyMirror: vi.fn(),
  loadPipelineMirror: vi.fn(),
  pipelineMirrorHistoryStart: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/admin-auth", () => ({
  isAuthenticated: mocks.isAuthenticated,
}));

vi.mock("@/lib/shopify", () => ({
  getStores: mocks.getStores,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: mocks.getSupabase,
}));

vi.mock("@/lib/kpi-sales", () => ({
  getPipelineDashboardData: mocks.getPipelineDashboardData,
}));

vi.mock("@/lib/pipeline-shopify-mirror", () => ({
  syncPipelineShopifyMirror: mocks.syncPipelineShopifyMirror,
  loadPipelineMirror: mocks.loadPipelineMirror,
  pipelineMirrorHistoryStart: mocks.pipelineMirrorHistoryStart,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/shopify/pipeline/route";

const dashboardData = {
  metrics: { totalDrafts: 0 },
  prediction: { monthlyForecasts: [] },
  channelMetrics: { employeeBreakdown: [] },
  leaderboard: [],
  warnings: [],
};

function request(query = "") {
  return new NextRequest(`https://tools.rftransparent.ca/api/shopify/pipeline${query}`);
}

function mockSupabase(cached: { result: object; computed_at: string } | null) {
  const pipelineBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: cached })),
    upsert: vi.fn(async () => ({ error: null })),
  };
  pipelineBuilder.select.mockReturnValue(pipelineBuilder);
  pipelineBuilder.eq.mockReturnValue(pipelineBuilder);

  const employeesBuilder = {
    data: [],
    select: vi.fn(),
    eq: vi.fn(),
  };
  employeesBuilder.select.mockReturnValue(employeesBuilder);
  employeesBuilder.eq.mockReturnValue(employeesBuilder);

  const client = {
    from: vi.fn((table: string) => table === "employees" ? employeesBuilder : pipelineBuilder),
  };
  mocks.getSupabase.mockReturnValue(client);
  return { pipelineBuilder };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
  mocks.isAuthenticated.mockResolvedValue(true);
  mocks.getStores.mockReturnValue([
    { id: "store1", label: "Store 1" },
  ]);
  mocks.getPipelineDashboardData.mockResolvedValue(dashboardData);
  mocks.syncPipelineShopifyMirror.mockResolvedValue({ skipped: true });
  mocks.loadPipelineMirror.mockResolvedValue({ orders: [], drafts: [], warnings: [] });
  mocks.pipelineMirrorHistoryStart.mockImplementation((date: Date) => date);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/shopify/pipeline", () => {
  it("returns a fresh cache hit without rebuilding", async () => {
    mockSupabase({
      result: { metrics: { totalDrafts: 4 } },
      computed_at: "2026-08-13T11:30:00Z",
    });

    const response = await GET(request());

    expect(response.headers.get("X-Pipeline-Cache")).toBe("hit");
    expect(mocks.getPipelineDashboardData).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("returns expired data immediately and schedules a background rebuild", async () => {
    mockSupabase({
      result: { metrics: { totalDrafts: 4 } },
      computed_at: "2026-08-13T10:00:00Z",
    });

    const response = await GET(request());

    expect(response.headers.get("X-Pipeline-Cache")).toBe("stale");
    expect((await response.json()).metrics.totalDrafts).toBe(4);
    expect(mocks.getPipelineDashboardData).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("builds and caches data when no cached result exists", async () => {
    const { pipelineBuilder } = mockSupabase(null);

    const response = await GET(request());

    expect(response.headers.get("X-Pipeline-Cache")).toBe("miss");
    expect(mocks.getPipelineDashboardData).toHaveBeenCalledOnce();
    expect(pipelineBuilder.upsert).toHaveBeenCalledOnce();
  });

  it("keeps manual refresh synchronous", async () => {
    mockSupabase({
      result: { metrics: { totalDrafts: 4 } },
      computed_at: "2026-08-13T11:30:00Z",
    });

    const response = await GET(request("?refresh=true"));

    expect(response.headers.get("X-Pipeline-Cache")).toBe("refresh");
    expect(mocks.getPipelineDashboardData).toHaveBeenCalledOnce();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
