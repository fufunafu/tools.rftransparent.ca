/** Initial operating allowances, not statistically calibrated service levels. */
export interface GlassPolicy {
  order_interval_days: number;
  fast_safety_days: number;
  regular_safety_days: number;
  slow_safety_days: number;
  slow_min_units: number;
  delay_days: number;
}
export const DEFAULT_GLASS_POLICY: GlassPolicy = {
  order_interval_days: 30, fast_safety_days: 21, regular_safety_days: 14,
  slow_safety_days: 7, slow_min_units: 2, delay_days: 21,
};
export const GLASS_POLICY_FIELDS: Record<keyof GlassPolicy, { label: string; max: number }> = {
  order_interval_days: { label: "Days between China orders", max: 365 },
  fast_safety_days: { label: "Fast sellers: safety days", max: 180 },
  regular_safety_days: { label: "Regular sellers: safety days", max: 180 },
  slow_safety_days: { label: "Slow sellers: safety days", max: 180 },
  slow_min_units: { label: "Slow sellers: minimum units", max: 100 },
  delay_days: { label: "Delivery delay scenario: extra days", max: 180 },
};
export function glassPolicy(value?: Partial<GlassPolicy> | null): GlassPolicy {
  return { ...DEFAULT_GLASS_POLICY, ...value };
}
export function validateGlassPolicy(value: unknown): value is GlassPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return Object.keys(obj).length === Object.keys(GLASS_POLICY_FIELDS).length &&
    Object.entries(GLASS_POLICY_FIELDS).every(([key, { max }]) =>
      typeof obj[key] === "number" && Number.isInteger(obj[key]) && (obj[key] as number) >= (key === "order_interval_days" ? 1 : 0) && (obj[key] as number) <= max);
}
export type GlassDemandBand = "fast" | "regular" | "slow";
export function glassDemandBand(annualUnits: number): GlassDemandBand {
  return annualUnits >= 365 ? "fast" : annualUnits < 12 ? "slow" : "regular";
}
