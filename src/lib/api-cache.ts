import { after } from "next/server";
import { getSupabase } from "@/lib/supabase";

// Read-through cache backed by the api_cache Supabase table (migration 060).
// Unlike a per-instance in-memory Map, this survives cold starts and is shared
// across Fluid Compute instances.
//
// Degrades gracefully: if the table doesn't exist yet (migration not applied)
// or any cache op errors, it silently computes live. So deploying this code
// before the migration is applied just means "no caching" — never a broken
// route. Only cache data that is safe to serve slightly stale; do NOT wrap
// responses that include values a user just entered and expects to see now.
//
// An entry past its TTL is still served for up to STALE_WINDOW_MS while a
// refresh runs after the response, so the first visit after a quiet spell
// doesn't wait on the full recompute (Shopify and friends can take tens of
// seconds). Older entries, and calls outside a request, recompute live.
const STALE_WINDOW_MS = 30 * 60 * 1000;
const refreshing = new Set<string>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  opts?: { forceRefresh?: boolean }
): Promise<{ data: T; cachedAt: string | null }> {
  const supabase = getSupabase();

  if (!opts?.forceRefresh) {
    const { data, error } = await supabase
      .from("api_cache")
      .select("result, computed_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (!error && data) {
      const age = Date.now() - new Date(data.computed_at).getTime();
      if (age < ttlMs) {
        return { data: data.result as T, cachedAt: data.computed_at };
      }
      if (age < ttlMs + STALE_WINDOW_MS && refreshAfterResponse(key, compute)) {
        return { data: data.result as T, cachedAt: data.computed_at };
      }
    }
  }

  return computeAndStore(key, compute);
}

function refreshAfterResponse<T>(key: string, compute: () => Promise<T>): boolean {
  // Another request on this instance is already refreshing this key.
  if (refreshing.has(key)) return true;
  try {
    after(async () => {
      try {
        await computeAndStore(key, compute);
      } catch (err) {
        console.warn(`[api-cache] background refresh failed for "${key}": ${err instanceof Error ? err.message : err}`);
      } finally {
        refreshing.delete(key);
      }
    });
  } catch {
    // Outside a request scope (scripts, tests): nothing to defer to.
    return false;
  }
  refreshing.add(key);
  return true;
}

async function computeAndStore<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<{ data: T; cachedAt: string | null }> {
  const supabase = getSupabase();
  const data = await compute();
  const computedAt = new Date().toISOString();
  // Best-effort write — caching is an optimization, not correctness. A missing
  // table or transient error just means the next request recomputes.
  const { error: writeError } = await supabase
    .from("api_cache")
    .upsert({ cache_key: key, result: data, computed_at: computedAt });
  if (writeError) {
    console.warn(`[api-cache] write failed for "${key}": ${writeError.message}`);
  }

  return { data, cachedAt: computedAt };
}
