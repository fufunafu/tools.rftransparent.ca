// Client-side cache for marketing API responses, persisted in localStorage.
// Entries expire after TTL_MS so the dashboard self-refreshes during the day;
// legacy entries without a timestamp are treated as expired.

const PREFIX = "marketing_cache_v1:";
const TTL_MS = 30 * 60 * 1000;

interface Entry {
  ts: number;
  data: unknown;
}

export function mktCacheSave(key: string, data: unknown): void {
  try {
    const entry: Entry = { ts: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {}
}

export function mktCacheLoad<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<Entry>;
    if (typeof entry?.ts !== "number" || Date.now() - entry.ts > TTL_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.data as T;
  } catch {
    return null;
  }
}

export function mktCacheClearAll(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
