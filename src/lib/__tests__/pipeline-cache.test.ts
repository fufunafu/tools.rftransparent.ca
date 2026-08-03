import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  pipelineCacheSave,
  pipelineCacheLoad,
  PIPELINE_CACHE_TTL_MS,
} from "@/lib/pipeline-cache";

// Vitest runs in a node environment, so provide a minimal localStorage.
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    get size() {
      return store.size;
    },
    raw: store,
  };
}

let ls: ReturnType<typeof makeLocalStorage>;

beforeEach(() => {
  ls = makeLocalStorage();
  vi.stubGlobal("localStorage", ls);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pipeline cache", () => {
  it("round-trips a saved entry", () => {
    pipelineCacheSave("store=all&days=90", { leaderboard: [1, 2] });
    const hit = pipelineCacheLoad<{ leaderboard: number[] }>("store=all&days=90");
    expect(hit?.data).toEqual({ leaderboard: [1, 2] });
    expect(hit?.ts).toBe(Date.now());
  });

  it("misses on an unknown key", () => {
    expect(pipelineCacheLoad("nope")).toBeNull();
  });

  it("expires and removes entries past the TTL", () => {
    pipelineCacheSave("k", { v: 1 });
    vi.advanceTimersByTime(PIPELINE_CACHE_TTL_MS + 1);
    expect(pipelineCacheLoad("k")).toBeNull();
    expect(ls.size).toBe(0);
  });

  it("still serves an entry just inside the TTL", () => {
    pipelineCacheSave("k", { v: 1 });
    vi.advanceTimersByTime(PIPELINE_CACHE_TTL_MS - 1);
    expect(pipelineCacheLoad<{ v: number }>("k")?.data).toEqual({ v: 1 });
  });

  it("rejects and removes legacy entries without a numeric ts", () => {
    ls.raw.set("pipeline_cache_v1:k", JSON.stringify({ data: { v: 1 } }));
    expect(pipelineCacheLoad("k")).toBeNull();
    expect(ls.size).toBe(0);
  });

  it("returns null on malformed JSON instead of throwing", () => {
    ls.raw.set("pipeline_cache_v1:k", "{not json");
    expect(pipelineCacheLoad("k")).toBeNull();
  });

  it("swallows quota errors on save", () => {
    vi.stubGlobal("localStorage", {
      ...ls,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => pipelineCacheSave("k", { v: 1 })).not.toThrow();
  });
});
