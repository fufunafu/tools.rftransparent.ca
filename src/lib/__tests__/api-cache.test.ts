import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn();
const afterMock = vi.fn();

vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => afterMock(task) }));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}));

import { cached } from "@/lib/api-cache";

beforeEach(() => {
  maybeSingleMock.mockReset();
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({ error: null });
  afterMock.mockReset();
  // Default to "outside a request", like Next does in scripts and tests.
  afterMock.mockImplementation(() => {
    throw new Error("`after` was called outside a request scope");
  });
});

function staleEntry(minutesOld: number) {
  return {
    data: { result: { v: 1 }, computed_at: new Date(Date.now() - minutesOld * 60 * 1000).toISOString() },
    error: null,
  };
}

function deferRefreshes(): Array<() => Promise<void>> {
  const tasks: Array<() => Promise<void>> = [];
  afterMock.mockImplementation((task: () => Promise<void>) => { tasks.push(task); });
  return tasks;
}

const TTL = 5 * 60 * 1000;

describe("cached", () => {
  it("returns a fresh cached value without calling compute", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { result: { v: 1 }, computed_at: new Date().toISOString() },
      error: null,
    });
    const compute = vi.fn();

    const { data } = await cached("k", TTL, compute);

    expect(data).toEqual({ v: 1 });
    expect(compute).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("recomputes and writes back on a cache miss", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const compute = vi.fn().mockResolvedValue({ v: 2 });

    const { data } = await cached("k", TTL, compute);

    expect(data).toEqual({ v: 2 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ cache_key: "k", result: { v: 2 } });
  });

  it("recomputes when the cached value is older than the TTL", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { result: { v: 1 }, computed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      error: null,
    });
    const compute = vi.fn().mockResolvedValue({ v: 3 });

    const { data } = await cached("k", TTL, compute);

    expect(data).toEqual({ v: 3 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("skips the cache read when forceRefresh is set", async () => {
    const compute = vi.fn().mockResolvedValue({ v: 4 });

    const { data } = await cached("k", TTL, compute, { forceRefresh: true });

    expect(data).toEqual({ v: 4 });
    expect(maybeSingleMock).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("computes live when the cache table is missing (graceful degradation)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'relation "api_cache" does not exist' } });
    const compute = vi.fn().mockResolvedValue({ v: 5 });

    const { data } = await cached("k", TTL, compute);

    expect(data).toEqual({ v: 5 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("still returns data when the cache write fails", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    upsertMock.mockResolvedValue({ error: { message: "write blew up" } });
    const compute = vi.fn().mockResolvedValue({ v: 6 });

    const { data } = await cached("k", TTL, compute);

    expect(data).toEqual({ v: 6 });
  });

  it("serves a recently expired value and refreshes it after the response", async () => {
    const tasks = deferRefreshes();
    maybeSingleMock.mockResolvedValue(staleEntry(10));
    const compute = vi.fn().mockResolvedValue({ v: 7 });

    const { data } = await cached("stale-k", TTL, compute);

    expect(data).toEqual({ v: 1 });
    expect(compute).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);

    await tasks[0]();
    expect(compute).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ cache_key: "stale-k", result: { v: 7 } });
  });

  it("schedules one refresh per key while it is in flight", async () => {
    const tasks = deferRefreshes();
    maybeSingleMock.mockResolvedValue(staleEntry(10));
    const compute = vi.fn().mockResolvedValue({ v: 8 });

    await cached("busy-k", TTL, compute);
    await cached("busy-k", TTL, compute);
    expect(tasks).toHaveLength(1);

    await tasks[0]();
    await cached("busy-k", TTL, compute);
    expect(tasks).toHaveLength(2);
  });

  it("recomputes live when the value is too old to serve", async () => {
    const tasks = deferRefreshes();
    maybeSingleMock.mockResolvedValue(staleEntry(60));
    const compute = vi.fn().mockResolvedValue({ v: 9 });

    const { data } = await cached("old-k", TTL, compute);

    expect(data).toEqual({ v: 9 });
    expect(tasks).toHaveLength(0);
  });

  it("keeps the stale value when the background refresh fails", async () => {
    const tasks = deferRefreshes();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    maybeSingleMock.mockResolvedValue(staleEntry(10));
    const compute = vi.fn().mockRejectedValue(new Error("Shopify down"));

    await cached("fail-k", TTL, compute);
    await expect(tasks[0]()).resolves.toBeUndefined();

    expect(upsertMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Shopify down"));
    warn.mockRestore();
  });
});
