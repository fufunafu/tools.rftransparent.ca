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
