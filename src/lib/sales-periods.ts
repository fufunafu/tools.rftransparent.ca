export const SALES_PERIODS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "180d", label: "Last 6 months", days: 180 },
  { id: "1y", label: "Last 1 year", days: 365 },
] as const;

export type SalesPeriod = (typeof SALES_PERIODS)[number]["id"];

export function parseSalesPeriod(value: string | string[] | undefined): SalesPeriod {
  return SALES_PERIODS.find((period) => period.id === value)?.id ?? "30d";
}

export function getSalesPeriod(period: SalesPeriod) {
  return SALES_PERIODS.find((option) => option.id === period)!;
}
