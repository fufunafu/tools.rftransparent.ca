const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function leadResponseTimeMs(
  submittedAt: string,
  completedAt: string | null | undefined,
): number | null {
  if (!completedAt) return null;
  const submittedTime = new Date(submittedAt).getTime();
  const completedTime = new Date(completedAt).getTime();
  if (Number.isNaN(submittedTime) || Number.isNaN(completedTime)) return null;
  const duration = completedTime - submittedTime;
  return duration >= 0 ? duration : null;
}

export function formatLeadResponseTime(milliseconds: number | null): string {
  if (milliseconds == null) return "No data";
  if (milliseconds < MINUTE_MS) return "<1m";

  if (milliseconds < HOUR_MS) {
    return `${Math.floor(milliseconds / MINUTE_MS)}m`;
  }

  if (milliseconds < DAY_MS) {
    const hours = Math.floor(milliseconds / HOUR_MS);
    const minutes = Math.floor((milliseconds % HOUR_MS) / MINUTE_MS);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(milliseconds / DAY_MS);
  const hours = Math.floor((milliseconds % DAY_MS) / HOUR_MS);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
