import { getSupabase } from "@/lib/supabase";

// A trail of who changed which setting. Same contract as cron run recording:
// writing is best-effort and NEVER throws, so a missing table (migration 062
// is applied by hand) can't stop someone from saving a setting.

export type SettingsArea = "notifications" | "rates" | "access" | "automations" | "assistant";

export interface SettingChange {
  area: string;
  actor: string;
  summary: string;
  created_at: string;
}

export async function recordSettingChange(change: {
  area: SettingsArea;
  actor: string;
  summary: string;
}): Promise<void> {
  try {
    await getSupabase().from("settings_audit").insert({
      area: change.area,
      actor: change.actor,
      summary: change.summary.slice(0, 500),
    });
  } catch (e) {
    console.error(`[settings-audit] could not record ${change.area} change:`, e);
  }
}

/**
 * Recent changes in one area. Returns tableMissing rather than throwing so a
 * settings page renders normally before the migration is applied.
 */
export async function getSettingChanges(
  area: SettingsArea,
  limit = 10
): Promise<{ changes: SettingChange[]; tableMissing: boolean }> {
  try {
    const { data, error } = await getSupabase()
      .from("settings_audit")
      .select("area, actor, summary, created_at")
      .eq("area", area)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { changes: [], tableMissing: true };
    return { changes: (data ?? []) as SettingChange[], tableMissing: false };
  } catch {
    return { changes: [], tableMissing: true };
  }
}

/**
 * Describes what changed between two lists of addresses, e.g.
 * "added ops@x.com, removed old@x.com". Empty string when nothing moved.
 */
export function describeListChange(before: string[], after: string[]): string {
  const beforeSet = new Set(before.map((s) => s.toLowerCase()));
  const afterSet = new Set(after.map((s) => s.toLowerCase()));
  const added = after.filter((e) => !beforeSet.has(e.toLowerCase()));
  const removed = before.filter((e) => !afterSet.has(e.toLowerCase()));
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.join(", ")}`);
  return parts.join("; ");
}
