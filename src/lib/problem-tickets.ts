// Shared shape + category list for problem tickets (client-facing issues:
// delivery errors, broken glass, wrong orders...). Imported by both the API
// route (validation) and the dashboard/charts (labels, colors), so the
// category list lives in exactly one place.

export interface ProblemTicket {
  id: string;
  client_name: string;
  ticket_date: string; // YYYY-MM-DD
  person: string | null;
  status: "in_progress" | "resolved";
  type: string;
  issue: string | null;
  resolution: string | null;
  store: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// Fixed order — chart colors are assigned by this order and must never be
// re-shuffled when a filter hides some categories (color follows the
// category, not its rank). Palette validated for colorblind separation.
export const PROBLEM_TYPES = [
  { value: "missing_items", label: "Missing items from order", color: "#2a78d6" },
  { value: "incorrect_order", label: "Incorrect order", color: "#eb6834" },
  { value: "broken_glass", label: "Broken glass panel", color: "#1baf7a" },
  { value: "shipping", label: "Shipping / delivery issue", color: "#eda100" },
  { value: "measurements", label: "Measurements issue", color: "#e87ba4" },
  { value: "tariffs", label: "Tariffs", color: "#008300" },
  { value: "other", label: "Other", color: "#4a3aa7" },
] as const;

export type ProblemTypeValue = (typeof PROBLEM_TYPES)[number]["value"];

export function isProblemType(value: unknown): value is ProblemTypeValue {
  return PROBLEM_TYPES.some((t) => t.value === value);
}

export function typeLabel(value: string): string {
  return PROBLEM_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function typeColor(value: string): string {
  return PROBLEM_TYPES.find((t) => t.value === value)?.color ?? "#4a3aa7";
}
