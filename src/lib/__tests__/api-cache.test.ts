import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn();

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
});

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
});
