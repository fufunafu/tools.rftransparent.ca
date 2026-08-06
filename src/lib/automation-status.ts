export type AutomationHealth = "healthy" | "error" | "stale" | "unknown";

export interface AutomationRunSummary {
  status: string;
  started_at: string;
}

export function getAutomationHealth(
  latest: AutomationRunSummary | undefined,
  staleAfterHours: number,
  now = Date.now(),
): AutomationHealth {
  if (!latest) return "unknown";
  if (latest.status === "error") return "error";

  const startedAt = new Date(latest.started_at).getTime();
  if (!Number.isFinite(startedAt)) return "unknown";
  if (now - startedAt > staleAfterHours * 60 * 60 * 1000) return "stale";
  return "healthy";
}

export function getAutomationDetailFailure(detail: string | undefined): string | null {
  if (!detail) return null;

  let body: unknown;
  try {
    body = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !("results" in body)) return null;

  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;

  const failures: string[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const row = result as Record<string, unknown>;
    const status = typeof row.status === "string" ? row.status : "";
    if (status === "ok" || status === "success") continue;

    const name = [row.label, row.scraper, row.store_id, row.store]
      .find((value): value is string => typeof value === "string" && value.length > 0)
      ?? "Sync step";
    const reason = typeof row.detail === "string" && row.detail
      ? row.detail
      : status || "failed";
    failures.push(`${name}: ${reason}`);
  }

  return failures.length > 0 ? failures.join("; ") : null;
}
