import { deductionRatio } from "@/lib/commission";
import { resolveSalesAttribution, type SalesAttribution } from "@/lib/sales-attribution";

interface SalesEmployee {
  id: string;
  name: string;
  department: string | null;
  shopify_tags: string[] | null;
}

export interface DashboardSalesRep {
  id: string;
  name: string;
  tags: string[];
  storeId: string;
  territory: boolean;
  placeholder: boolean;
  province?: string;
  hasEmployeeProfile: boolean;
  attributionExplanation?: string;
}

const ATTRIBUTION_EXPLANATIONS: Record<string, string> = {
  Rob: "RF orders and quotes matching Rob's configured name tags. Daniel's Quebec, Nova Scotia, New Brunswick and PEI territory takes priority. In British Columbia, Rob-tagged records stay with Rob instead of Aaron. Other records matching multiple reps are excluded.",
  Daniel: "RF orders and quotes tagged Daniel, ignoring case and surrounding spaces, plus all RF records in Quebec, Nova Scotia, New Brunswick and PEI, even without a tag. Territory rules take priority over tags, including Aaron's eligible BC territory. Outside those territories, conflicting rep tags are excluded. Territory uses shipping, or billing when shipping is absent.",
  Craig: "RF orders and quotes matching Craig's configured name tags. Daniel's Quebec, Nova Scotia, New Brunswick and PEI territory takes priority. British Columbia records created July 16, 2026 onward go to Aaron, or Rob when Rob-tagged. Other records matching multiple reps are excluded.",
  Marie: "BC Transparent orders and quotes carrying the exact Marijac tag, ignoring letter case and surrounding spaces. Marie name tags alone do not qualify.",
  Aaron: "RF orders and quotes tagged Aaron or Aron, ignoring case and surrounding spaces, plus British Columbia records created July 16, 2026 onward at midnight Toronto time, even without a tag. Tagged records can be outside BC or older than that date. Daniel's territory takes priority; Rob-tagged records stay with Rob. Other conflicting rep tags are excluded. Territory uses shipping, or billing when shipping is absent.",
};

// Store IDs follow SHOPIFY_STORE_*: RF, Glass Railing Store, BC.
const ROSTER = [
  { name: "Rob", storeId: "store1", aliases: ["rob", "#rob", "rob glas", "rob glass", "robert glas", "robert glass"] },
  { name: "Daniel", storeId: "store1", aliases: ["daniel", "daniel boudreau"] },
  { name: "Craig", storeId: "store1", aliases: ["craig", "craig scarr"] },
  { name: "Marie", storeId: "store3", aliases: ["marie", "marie gauthier"] },
  { name: "Aaron", storeId: "store1", aliases: ["aaron", "aron"], province: "BC", fallbackId: "sales-agent-aaron" },
];

const normalize = (value: string) => value.trim().toLowerCase();

/** The current roster, including agents without an employee profile or orders. */
export function dashboardSalesReps(employees: SalesEmployee[]): DashboardSalesRep[] {
  return ROSTER.map((config) => {
    const matches = employees.filter((employee) =>
      normalize(employee.department ?? "") === "sales" &&
      (config.aliases.includes(normalize(employee.name)) ||
        (config.name === "Aaron" && config.aliases.includes(normalize(employee.name).split(/\s+/)[0])))
    );
    if (matches.length > 1 || (matches.length === 0 && !config.fallbackId)) {
      throw new Error(`Could not identify ${config.name} in the active sales team.`);
    }
    const employee = matches[0];
    return {
      id: employee?.id ?? config.fallbackId!,
      name: employee?.name ?? config.name,
      tags: config.name === "Marie" ? ["marijac"] : [...new Set([...config.aliases, ...(employee?.shopify_tags ?? []).map(normalize)])],
      storeId: config.storeId,
      province: config.province,
      hasEmployeeProfile: !!employee,
      attributionExplanation: ATTRIBUTION_EXPLANATIONS[config.name],
      territory: config.name === "Daniel" || config.name === "Aaron",
      placeholder: false,
    };
  });
}

/** Narrow tag-only stores before pagination; territory stores still need untagged records. */
export function dashboardSalesSearchFilter(storeId: string, reps: DashboardSalesRep[], filter: string): string {
  const storeReps = reps.filter((rep) => rep.storeId === storeId && !rep.placeholder);
  if (storeReps.some((rep) => rep.territory)) return filter;
  const tags = [...new Set(storeReps.flatMap((rep) => rep.tags))];
  if (!tags.length) return filter;
  return `${filter} AND (${tags.map((tag) => `tag:${JSON.stringify(tag)}`).join(" OR ")})`;
}

export interface SalesAddress {
  provinceCode: string | null;
  province: string | null;
  countryCodeV2: string | null;
}

export interface DashboardSalesRecord {
  createdAt?: string;
  storeId: string;
  tags: string[];
  shippingAddress: SalesAddress | null;
  billingAddress: SalesAddress | null;
}

function salesProvince(record: DashboardSalesRecord): string {
  // Shipping destination takes precedence. Billing covers pickup orders without shipping.
  const address = record.shippingAddress ?? record.billingAddress;
  if (!address || (address.countryCodeV2 && address.countryCodeV2 !== "CA")) return "";
  return normalize(address.provinceCode || address.province || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function resolveDashboardSalesAttribution(
  record: DashboardSalesRecord,
  reps: DashboardSalesRep[],
): SalesAttribution {
  const province = salesProvince(record);
  const storeReps = reps.filter((rep) => rep.storeId === record.storeId && !rep.placeholder);
  // Aaron's BC territory starts July 16, 2026, at Toronto midnight.
  // This is a fixed start date, not a rolling two-month window.
  const territoryRep = storeReps.find((rep) => rep.territory && (rep.province === "BC"
    ? ["bc", "british columbia", "colombie-britannique"].includes(province) &&
      !!record.createdAt && new Date(record.createdAt) >= new Date("2026-07-16T04:00:00.000Z")
    : ["qc", "pq", "quebec", "ns", "nova scotia", "nouvelle-ecosse", "nb", "new brunswick", "nouveau-brunswick", "pe", "pei", "prince edward island", "ile-du-prince-edouard"].includes(province)));
  if (territoryRep) {
    if (territoryRep.province === "BC") {
      const rob = storeReps.find((rep) => rep.tags.includes("rob"));
      if (rob && record.tags.some((tag) => rob.tags.includes(normalize(tag)))) {
        return { status: "unique", employeeId: rob.id };
      }
    }
    return { status: "unique", employeeId: territoryRep.id };
  }
  // Aaron's exact tags are an additional route, independent of his BC start date.
  const aaron = storeReps.find((rep) => rep.province === "BC");
  const taggedAaron = aaron && record.tags.some((tag) => ["aaron", "aron"].includes(normalize(tag)));
  if (taggedAaron) {
    const rob = storeReps.find((rep) => rep.tags.includes("rob"));
    if (rob && record.tags.some((tag) => rob.tags.includes(normalize(tag)))) {
      return { status: "unique", employeeId: rob.id };
    }
  }
  const daniel = storeReps.find((rep) => rep.territory && !rep.province);
  const taggedDaniel = daniel && record.tags.some((tag) => normalize(tag) === "daniel");
  return resolveSalesAttribution(record.tags, storeReps.filter((rep) => !rep.territory ||
    (taggedAaron && rep.id === aaron.id) || (taggedDaniel && rep.id === daniel.id)));
}

type MoneySet = { shopMoney: { amount: string } } | null;

export interface DashboardSalesOrder extends DashboardSalesRecord {
  currentTotalPriceSet: MoneySet;
  currentTotalTaxSet: MoneySet;
  currentShippingPriceSet: MoneySet;
  totalPriceSet: MoneySet;
  totalTaxSet: MoneySet;
  totalShippingPriceSet: MoneySet;
  transactions: {
    kind: string;
    status: string;
    processedAt: string | null;
    amountSet: MoneySet;
  }[];
}

const money = (set: MoneySet) => Number(set?.shopMoney.amount) || 0;

/** Matches Rob's API report: successful payments less refunds, tax and shipping. */
export function salesInPeriod(order: DashboardSalesOrder, start: Date, end: Date): number {
  const ratio = deductionRatio({
    total: money(order.currentTotalPriceSet) || money(order.totalPriceSet),
    tax: money(order.currentTotalTaxSet) || money(order.totalTaxSet),
    shipping: money(order.currentShippingPriceSet) || money(order.totalShippingPriceSet),
  });
  let net = 0;
  for (const transaction of order.transactions) {
    if (transaction.status !== "SUCCESS" || !transaction.processedAt) continue;
    if (!["SALE", "CAPTURE", "REFUND"].includes(transaction.kind)) continue;
    const when = new Date(transaction.processedAt);
    if (!(when >= start && when < end)) continue;
    const signed = money(transaction.amountSet) * (transaction.kind === "REFUND" ? -1 : 1);
    net += signed * (1 - ratio);
  }
  return net;
}
