// Client-side cache for pipeline API responses, persisted in localStorage.
// Same shape as marketing-cache.ts: entries expire after TTL_MS so stale
// predictions don't linger indefinitely (they used to — the old inline cache
// had no expiry). The prefix is unchanged, so entries written before the TTL
// existed age out in place; malformed ones fail the ts check and are removed.

const PREFIX = "pipeline_cache_v1:";
export const PIPELINE_CACHE_TTL_MS = 30 * 60 * 1000;

interface Entry {
  ts: number;
  data: unknown;
}

export function pipelineCacheSave(key: string, data: unknown): void {
  try {
    const entry: Entry = { ts: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore quota errors — the in-memory cache still works.
  }
}

export function pipelineCacheLoad<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    if (typeof entry?.ts !== "number" || Date.now() - entry.ts > PIPELINE_CACHE_TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return { data: entry.data as T, ts: entry.ts };
  } catch {
    return null;
  }
}
