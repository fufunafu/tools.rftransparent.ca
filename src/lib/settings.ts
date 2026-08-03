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

const SALES_TARGETS_KEY = "sales_targets";

/**
 * Monthly net-revenue target per store, keyed by store id (store1/2/3).
 * A store with no target set simply has no target column — the dashboard
 * renders it neutral rather than inventing a number to measure against.
 */
export type SalesTargets = Record<string, number>;

export async function getSalesTargets(): Promise<SalesTargets> {
  const stored = await getSetting<SalesTargets>(SALES_TARGETS_KEY, {});
  // Drop anything non-numeric or non-positive so a bad row can't produce a
  // divide-by-zero or a nonsense percentage on the dashboard.
  const clean: SalesTargets = {};
  for (const [store, value] of Object.entries(stored ?? {})) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) clean[store] = value;
  }
  return clean;
}

export async function putSalesTargets(targets: SalesTargets): Promise<void> {
  await putSetting(SALES_TARGETS_KEY, targets);
}

const WALL_ANNOUNCEMENT_KEY = "wall_announcement";

/**
 * The one-line banner across the top of the office wall board — "inventory
 * count Saturday, no pickups before 11" territory. Deliberately a single
 * message, not a list: the TV is glanced at, not read.
 */
export interface WallAnnouncement {
  message: string;
  /** Display name of whoever posted it, for the "— Robert" attribution. */
  author: string;
  updated_at: string;
}

export async function getWallAnnouncement(): Promise<WallAnnouncement | null> {
  const stored = await getSetting<WallAnnouncement | null>(WALL_ANNOUNCEMENT_KEY, null);
  if (!stored || typeof stored.message !== "string" || !stored.message.trim()) return null;
  return stored;
}

export async function putWallAnnouncement(message: string, author: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    // "Cleared" is a DELETED row. app_settings.value is NOT NULL, so
    // upserting null violates the constraint and the old banner silently
    // survives — which put a stale message on the office TV.
    const { error } = await getSupabase()
      .from("app_settings")
      .delete()
      .eq("key", WALL_ANNOUNCEMENT_KEY);
    if (error) throw new Error(error.message);
    return;
  }
  await putSetting(WALL_ANNOUNCEMENT_KEY, {
    message: trimmed.slice(0, 200),
    author: author.slice(0, 60),
    updated_at: new Date().toISOString(),
  });
}

const WALL_TOKEN_KEY = "wall_token";

/**
 * The unguessable token in /wall/[token]. The office TV opens one URL and
 * needs no session, so no machine on a shared floor is left permanently
 * signed into the tools. Rotating the value here revokes the old link.
 *
 * Returns null when no token has been issued — /wall then 404s rather than
 * falling open.
 */
export async function getWallToken(): Promise<string | null> {
  const token = await getSetting<string | null>(WALL_TOKEN_KEY, null);
  return typeof token === "string" && token.length >= 16 ? token : null;
}

export async function issueWallToken(): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "");
  await putSetting(WALL_TOKEN_KEY, token);
  return token;
}

export async function revokeWallToken(): Promise<void> {
  await putSetting(WALL_TOKEN_KEY, null);
}

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
