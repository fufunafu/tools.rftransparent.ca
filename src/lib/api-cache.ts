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
    }
  }

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
