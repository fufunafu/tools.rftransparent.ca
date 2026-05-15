import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";

// Cache + invalidation strategy:
//   - All entries are tagged with `cs:followup` (coarse) and `cs:followup:{store}`
//     (store-scoped — what mutations invalidate).
//   - revalidate: 60s — soft TTL so stale data eventually self-heals.

const REVALIDATE_SECONDS = 60;

function tagsFor(storeId: string): string[] {
  return ["cs:followup", `cs:followup:${storeId}`];
}

export interface FollowupSummary {
  due_today: number;
  overdue: number;
  total_active: number;
  total_closed: number;
  won_count: number;
  lost_count: number;
  conversion_rate: number;
  avg_attempts: number;
  avg_cycle_won: number | null;
  avg_cycle_lost: number | null;
  pipeline_value: number;
  won_value: number;
  by_status: Record<string, number>;
  loss_reasons: Record<string, number>;
  last_synced_at: string | null;
  lead_distribution: Record<string, number>;
}

export function getFollowupSummary(
  storeId: string,
  cutoff: string | null,
): Promise<FollowupSummary | null> {
  return unstable_cache(
    async () => {
      const { data, error } = await getSupabase().rpc("cs_followup_summary", {
        p_store_id: storeId,
        p_cutoff: cutoff,
      });
      if (error) throw new Error(error.message);
      const row = (data?.[0] as FollowupSummary | undefined) ?? null;
      if (!row) return null;
      // Postgres returns numeric as string in some PostgREST configs; coerce.
      return {
        ...row,
        conversion_rate: Number(row.conversion_rate),
        avg_attempts: Number(row.avg_attempts),
        avg_cycle_won:
          row.avg_cycle_won === null ? null : Number(row.avg_cycle_won),
        avg_cycle_lost:
          row.avg_cycle_lost === null ? null : Number(row.avg_cycle_lost),
        pipeline_value: Number(row.pipeline_value),
        won_value: Number(row.won_value),
        lead_distribution: row.lead_distribution ?? {},
      };
    },
    ["cs:followup:summary", storeId, cutoff ?? "all"],
    { tags: tagsFor(storeId), revalidate: REVALIDATE_SECONDS },
  )();
}

export interface FollowupAnalyticsRow {
  month_key: string;
  total: number;
  won: number;
  lost: number;
  quoted_value: number;
  won_value: number;
  conversion_rate: number;
}

export function getFollowupAnalytics(
  storeId: string,
): Promise<FollowupAnalyticsRow[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await getSupabase().rpc("cs_followup_analytics", {
        p_store_id: storeId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: FollowupAnalyticsRow) => ({
        month_key: r.month_key,
        total: Number(r.total),
        won: Number(r.won),
        lost: Number(r.lost),
        quoted_value: Number(r.quoted_value),
        won_value: Number(r.won_value),
        conversion_rate: Number(r.conversion_rate),
      }));
    },
    ["cs:followup:analytics", storeId],
    { tags: tagsFor(storeId), revalidate: REVALIDATE_SECONDS },
  )();
}

export interface FollowupStaffRow {
  staff: string;
  total: number;
  won: number;
  lost: number;
  active: number;
  quoted_value: number;
  won_value: number;
  conversion_rate: number;
}

export function getFollowupByStaff(
  storeId: string,
  cutoff: string | null,
): Promise<FollowupStaffRow[]> {
  return unstable_cache(
    async () => {
      const { data, error } = await getSupabase().rpc("cs_followup_by_staff", {
        p_store_id: storeId,
        p_cutoff: cutoff,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: FollowupStaffRow) => ({
        staff: r.staff,
        total: Number(r.total),
        won: Number(r.won),
        lost: Number(r.lost),
        active: Number(r.active),
        quoted_value: Number(r.quoted_value),
        won_value: Number(r.won_value),
        conversion_rate: Number(r.conversion_rate),
      }));
    },
    ["cs:followup:by_staff", storeId, cutoff ?? "all"],
    { tags: tagsFor(storeId), revalidate: REVALIDATE_SECONDS },
  )();
}

/**
 * Compute the cutoff timestamp for a `?range=` param.
 */
export function rangeCutoff(range: string | null | undefined): string | null {
  if (!range || range === "all") return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}
