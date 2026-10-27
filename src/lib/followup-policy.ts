// RF Transparent's quote sequence uses calendar weeks, regardless of outcome.
export const RF_FOLLOWUP_LIMIT = 2;

export function hasFixedFollowupSchedule(storeId: string): boolean {
  return storeId === "store1";
}

export function rfNextFollowup(completedAttempts: number, anchor: string): string | null {
  if (completedAttempts >= RF_FOLLOWUP_LIMIT) return null;
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + (completedAttempts === 0 ? 7 : 21));
  return date.toISOString();
}
