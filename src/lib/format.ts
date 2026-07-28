// Canonical money formatting. The business bills in CAD; use these instead of
// per-file Intl.NumberFormat copies so amounts render the same everywhere.

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const CAD_WHOLE = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

/** $1,234.56 */
export function formatCAD(n: number): string {
  return CAD.format(n);
}

/** $1,235 — for dashboards/emails where cents are noise */
export function formatCADWhole(n: number): string {
  return CAD_WHOLE.format(n);
}

/** $12.3k / $1.2M — compact form for chart axes and stat tiles */
export function formatCADShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return CAD_WHOLE.format(n);
}
