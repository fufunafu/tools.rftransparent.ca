import { getSupabase } from "@/lib/supabase";
import { OWNER_EMAIL } from "@/lib/authz";

// Typed access to the app_settings key/value table (already used by the
// sync-schedule setting). Every read falls back to a hard-coded default, so
// a missing row — or a missing table — degrades to today's behavior rather
// than breaking a cron.

const NOTIFICATIONS_KEY = "notifications";

export interface NotificationSettings {
  // Who hears about it when a scheduled job fails.
  cron_alerts: string[];
  // Monday-morning problem-ticket digest.
  problems_digest: string[];
  // Weekday follow-up reminders, one inbox per store.
  followup_by_store: Record<string, string>;
}

// These mirror what was hard-coded in the cron routes before this page
// existed, so behavior is identical until someone edits the settings.
export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  cron_alerts: [process.env.CRON_ALERT_EMAIL || OWNER_EMAIL],
  problems_digest: ["info@glass-railing.com"],
  followup_by_store: {
    store1: "info@glass-railing.com",
    store2: "info@glassrailingstore.com",
    store3: "anne@cloture-verre.com",
  },
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await getSupabase()
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data?.value) return fallback;
    return data.value as T;
  } catch {
    // app_settings may not exist in a fresh environment.
    return fallback;
  }
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  const { error } = await getSupabase()
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const stored = await getSetting<Partial<NotificationSettings>>(NOTIFICATIONS_KEY, {});
  // Merge per-field rather than wholesale: a settings row written before a
  // new notification type existed shouldn't blank out that type's default.
  return {
    cron_alerts: nonEmpty(stored.cron_alerts) ?? NOTIFICATION_DEFAULTS.cron_alerts,
    problems_digest: nonEmpty(stored.problems_digest) ?? NOTIFICATION_DEFAULTS.problems_digest,
    followup_by_store: {
      ...NOTIFICATION_DEFAULTS.followup_by_store,
      ...(stored.followup_by_store ?? {}),
    },
  };
}

export async function putNotificationSettings(value: NotificationSettings): Promise<void> {
  await putSetting(NOTIFICATIONS_KEY, value);
}

function nonEmpty(list: string[] | undefined): string[] | null {
  const clean = (list ?? []).map((s) => s.trim()).filter(Boolean);
  return clean.length ? clean : null;
}

// Loose check — enough to catch typos in the settings form without trying to
// out-clever the email spec.
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
