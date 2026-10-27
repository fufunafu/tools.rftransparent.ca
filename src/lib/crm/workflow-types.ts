export interface DuplicateGroup {
  kind: "email" | "phone"; value: string; fingerprint: string; total: number;
  records: { id: string; title: string; summary: string; source: string }[];
  decision: "duplicate" | "separate" | null; reviewed_by: string | null;
}
export interface CrmAsset {
  id: string; kind: "file" | "recording"; filename: string | null; status: "pending" | "copying" | "ready" | "blocked" | "failed";
  byte_size: number | null; error_code: string | null; copied_at: string | null;
}
export interface CaptureReview {
  id: string; revision: number; kind: "calls" | "emails"; occurred_at: string;
  reason: string; payload: Record<string, unknown>; matched_ids: string[];
  candidates: { id: string; title: string; summary: string }[];
}
export interface WorkflowStatus {
  pendingIndex: number; contactIndexPending: number;
  assets: { status: string; total: number }[];
  capture: { enabled: boolean; started_at: string } | null;
  captureCounts: { status: string; total: number }[];
  remindersConfigured: boolean; filesConfigured: boolean;
  latestRun: { started_at: string; finished_at: string | null; status: string } | null;
}
