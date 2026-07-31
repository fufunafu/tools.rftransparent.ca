// Shared shape + category lists for bug reports (problems with our own
// software, as opposed to problem_tickets which are problems for customers).
// Imported by both the API routes (validation) and the dashboard (labels,
// colors), so each list lives in exactly one place.

export interface BugSystem {
  id: string;
  name: string;
}

export interface BugAttachment {
  id: string;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface BugComment {
  id: string;
  bug_id: string;
  author: string;
  body: string;
  created_at: string;
  /** Images posted with this comment. Empty before migration 064. */
  attachments?: BugAttachment[];
}

export interface BugReport {
  id: string;
  system_id: string;
  title: string;
  type: string;
  status: BugStatusValue;
  description: string | null;
  steps: string | null;
  reported_by: string | null;
  created_at: string;
  updated_at: string;
  repaired_at: string | null;
  // Joined on read so the list can render without a second round trip.
  attachments?: BugAttachment[];
  comment_count?: number;
}

// Fixed order — chart colors are assigned by this order and must never be
// re-shuffled when a filter hides some categories (color follows the
// category, not its rank). Same validated palette as PROBLEM_TYPES.
export const BUG_TYPES = [
  { value: "crash", label: "Error or crash", color: "#eb6834" },
  { value: "wrong_data", label: "Wrong or missing data", color: "#2a78d6" },
  { value: "workflow", label: "Doesn't work as expected", color: "#1baf7a" },
  { value: "ui", label: "Layout or display", color: "#eda100" },
  { value: "slow", label: "Slow or times out", color: "#e87ba4" },
  { value: "access", label: "Can't sign in / permission", color: "#008300" },
  { value: "other", label: "Other", color: "#4a3aa7" },
] as const;

export type BugTypeValue = (typeof BUG_TYPES)[number]["value"];

export function isBugType(value: unknown): value is BugTypeValue {
  return BUG_TYPES.some((t) => t.value === value);
}

export function bugTypeLabel(value: string): string {
  return BUG_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function bugTypeColor(value: string): string {
  return BUG_TYPES.find((t) => t.value === value)?.color ?? "#4a3aa7";
}

export const BUG_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "Being fixed" },
  { value: "repaired", label: "Repaired" },
  { value: "wont_fix", label: "Won't fix" },
] as const;

export type BugStatusValue = (typeof BUG_STATUSES)[number]["value"];

export function isBugStatus(value: unknown): value is BugStatusValue {
  return BUG_STATUSES.some((s) => s.value === value);
}

export function bugStatusLabel(value: string): string {
  return BUG_STATUSES.find((s) => s.value === value)?.label ?? value;
}

/** Statuses that still need someone's attention. */
export function isOpenStatus(value: string): boolean {
  return value === "open" || value === "in_progress";
}

export interface BugMetrics {
  total: number;
  needsAttention: number;
  reportedLastSevenDays: number;
  averageRepairDays: number | null;
  statusCounts: Record<BugStatusValue, number>;
}

/** Live summary values derived from the same reports shown in the list. */
export function getBugMetrics(bugs: BugReport[], now = Date.now()): BugMetrics {
  const statusCounts: Record<BugStatusValue, number> = {
    open: 0,
    in_progress: 0,
    repaired: 0,
    wont_fix: 0,
  };
  const sevenDaysAgo = now - 7 * 86400000;
  let reportedLastSevenDays = 0;
  const repairDurations: number[] = [];

  for (const bug of bugs) {
    statusCounts[bug.status] += 1;

    const createdAt = new Date(bug.created_at).getTime();
    if (Number.isFinite(createdAt) && createdAt >= sevenDaysAgo && createdAt <= now) {
      reportedLastSevenDays += 1;
    }

    if (bug.status === "repaired" && bug.repaired_at && Number.isFinite(createdAt)) {
      const repairedAt = new Date(bug.repaired_at).getTime();
      if (Number.isFinite(repairedAt) && repairedAt >= createdAt) {
        repairDurations.push((repairedAt - createdAt) / 86400000);
      }
    }
  }

  return {
    total: bugs.length,
    needsAttention: statusCounts.open + statusCounts.in_progress,
    reportedLastSevenDays,
    averageRepairDays:
      repairDurations.length > 0
        ? repairDurations.reduce((sum, days) => sum + days, 0) / repairDurations.length
        : null,
    statusCounts,
  };
}

// Screenshots only, and small enough that a phone photo still fits.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Private Supabase Storage bucket holding the screenshot objects. */
export const BUG_BUCKET = "bug-attachments";

// ─── Migration guards ────────────────────────────────────────────────────────
// Migrations here are applied by hand, so every query that depends on a new
// table or column has to survive it not being there yet.

/** The table doesn't exist — migration 063 hasn't been applied. */
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205";
}

/**
 * The column doesn't exist — migration 064 (bug_attachments.comment_id)
 * hasn't been applied. 42703 is Postgres on a filter; PGRST204 is PostgREST's
 * schema cache on a write.
 */
export function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
