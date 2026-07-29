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
