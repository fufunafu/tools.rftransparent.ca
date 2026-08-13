// Client-side cache for pipeline API responses, persisted in localStorage.
// Fresh entries avoid a request. Older entries render immediately while the
// client refreshes them in the background. The maximum stale window prevents
// obsolete predictions from remaining on a browser indefinitely.

const PREFIX = "pipeline_cache_v1:";
export const PIPELINE_CACHE_TTL_MS = 30 * 60 * 1000;
export const PIPELINE_CACHE_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry {
  ts: number;
  data: unknown;
}

export function pipelineCacheSave(key: string, data: unknown): number {
  let ts = Date.now();
  try {
    if (data && typeof data === "object" && "cachedAt" in data) {
      const cachedAt = (data as { cachedAt?: unknown }).cachedAt;
      if (typeof cachedAt === "string") {
        const serverTimestamp = Date.parse(cachedAt);
        if (Number.isFinite(serverTimestamp) && serverTimestamp <= ts) ts = serverTimestamp;
      }
    }
    const entry: Entry = { ts, data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore quota errors — the in-memory cache still works.
  }
  return ts;
}

export function pipelineCacheLoad<T>(key: string): { data: T; ts: number; isStale: boolean } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    const age = typeof entry?.ts === "number" ? Date.now() - entry.ts : Infinity;
    if (typeof entry?.ts !== "number" || age > PIPELINE_CACHE_MAX_STALE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return {
      data: entry.data as T,
      ts: entry.ts,
      isStale: age > PIPELINE_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}
