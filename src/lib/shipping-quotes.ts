import { getSupabase } from "@/lib/supabase";
import { getSetting, putSetting } from "@/lib/settings";
import { fetchAllPages, getStores } from "@/lib/shopify";
import {
  calculateFreightClass,
  cheapestRate,
  isFreightcomConfigured,
  moneyToNumber,
  requestRate,
  waitForRate,
  type FreightcomAddress,
  type FreightcomLocation,
  type FreightcomPackage,
  type FreightcomPallet,
  type FreightcomRate,
  type FreightcomRateRequest,
} from "@/lib/freightcom";

// ─── Settings ────────────────────────────────────────────────────────────────
// Where shipments leave from and what a "typical box" looks like when Shopify
// has no weight on the order. Stored in app_settings so the warehouse can fix
// the origin address without a deploy.

const SETTINGS_KEY = "shipping_quotes";

export interface ShippingQuoteSettings {
  origin: {
    name: string;
    contact_name: string;
    phone: string;
    // Freightcom requires an origin email for international (e.g. US-bound)
    // rate requests.
    email: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    region: string;
    country: string;
    postal_code: string;
  };
  default_package: {
    weight_lb: number;
    length_in: number;
    width_in: number;
    height_in: number;
  };
  // Shopify shipping-method titles that mean "no carrier needed" — local
  // pickup, in-house delivery. Matched case-insensitively as substrings.
  skip_shipping_methods: string[];
  // Only orders newer than this many days get auto-quoted by the cron.
  lookback_days: number;
  // Courier per-package weight ceiling. Orders heavier than this are split
  // across several packages — Freightcom rejects a single package above the
  // carrier max ("weight-exceeds-max-weight").
  max_package_weight_lb: number;
  // How glass ships: any order containing glass goes LTL in wooden crates,
  // ceil(glass count / glass_per_crate) of them, hardware packed inside the
  // crates. Orders without glass ship as parcels.
  crate: {
    glass_per_crate: number;
    length_in: number;
    width_in: number;
    height_in: number;
    // Empty crate weight, added per crate on top of the product weight.
    tare_lb: number;
    // A line item counts as glass when its SKU starts with one of these
    // (inventory convention: GP{height}X{width}) …
    glass_sku_prefixes: string[];
    // … or, for items with no SKU, when its title contains one of these.
    glass_title_keywords: string[];
  };
}

export const SHIPPING_QUOTE_DEFAULTS: ShippingQuoteSettings = {
  origin: {
    name: "RF Transparent",
    contact_name: "Warehouse",
    phone: "",
    email: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    region: "ON",
    country: "CA",
    postal_code: "",
  },
  default_package: { weight_lb: 30, length_in: 48, width_in: 12, height_in: 12 },
  skip_shipping_methods: ["pickup", "pick up", "pick-up", "local delivery"],
  lookback_days: 14,
  max_package_weight_lb: 150,
  crate: {
    glass_per_crate: 15,
    // PLACEHOLDER dimensions — set the real usual crate size in Settings
    // (read it off any past LTL booking in the Freightcom dashboard).
    length_in: 72,
    width_in: 30,
    height_in: 48,
    tare_lb: 80,
    glass_sku_prefixes: ["GP"],
    glass_title_keywords: ["glass"],
  },
};

export async function getShippingQuoteSettings(): Promise<ShippingQuoteSettings> {
  const stored = await getSetting<Partial<ShippingQuoteSettings>>(SETTINGS_KEY, {});
  return {
    origin: { ...SHIPPING_QUOTE_DEFAULTS.origin, ...(stored.origin ?? {}) },
    default_package: { ...SHIPPING_QUOTE_DEFAULTS.default_package, ...(stored.default_package ?? {}) },
    skip_shipping_methods: Array.isArray(stored.skip_shipping_methods)
      ? stored.skip_shipping_methods
      : SHIPPING_QUOTE_DEFAULTS.skip_shipping_methods,
    lookback_days:
      typeof stored.lookback_days === "number" && stored.lookback_days > 0
        ? stored.lookback_days
        : SHIPPING_QUOTE_DEFAULTS.lookback_days,
    max_package_weight_lb:
      typeof stored.max_package_weight_lb === "number" && stored.max_package_weight_lb > 0
        ? stored.max_package_weight_lb
        : SHIPPING_QUOTE_DEFAULTS.max_package_weight_lb,
    crate: { ...SHIPPING_QUOTE_DEFAULTS.crate, ...(stored.crate ?? {}) },
  };
}

export async function putShippingQuoteSettings(settings: ShippingQuoteSettings): Promise<void> {
  await putSetting(SETTINGS_KEY, settings);
}

export function originIsComplete(settings: ShippingQuoteSettings): boolean {
  const o = settings.origin;
  return Boolean(o.address_line_1 && o.city && o.region && o.country && o.postal_code);
}

// ─── Shopify orders that need shipping ───────────────────────────────────────

const ORDERS_QUERY = `
  query($after: String, $search: String) {
    orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $search, after: $after) {
      edges {
        cursor
        node {
          id name createdAt cancelledAt displayFulfillmentStatus email phone totalWeight
          customer { displayName }
          shippingAddress { name company address1 address2 city provinceCode countryCodeV2 zip phone }
          shippingLine { title code }
          lineItems(first: 50) {
            nodes {
              title quantity requiresShipping
              variant { sku inventoryItem { measurement { weight { value unit } } } }
            }
          }
        }
      }
      pageInfo { hasNextPage }
    }
  }
`;

interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  email: string | null;
  phone: string | null;
  totalWeight: number | null; // grams
  customer: { displayName: string } | null;
  shippingAddress: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    provinceCode: string | null;
    countryCodeV2: string | null;
    zip: string | null;
    phone: string | null;
  } | null;
  shippingLine: { title: string | null; code: string | null } | null;
  lineItems: {
    nodes: {
      title: string;
      quantity: number;
      requiresShipping: boolean;
      variant: {
        sku: string | null;
        inventoryItem: { measurement: { weight: { value: number; unit: string } | null } | null } | null;
      } | null;
    }[];
  };
}

interface OrdersData {
  orders: { edges: { node: ShopifyOrderNode; cursor: string }[]; pageInfo: { hasNextPage: boolean } };
}

export async function fetchShippableOrders(storeId: string, sinceDays: number): Promise<ShopifyOrderNode[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().split("T")[0];
  const { nodes } = await fetchAllPages<ShopifyOrderNode, OrdersData>({
    storeId,
    query: ORDERS_QUERY,
    getConnection: (data) => data.orders,
    variables: { search: `created_at:>=${since} fulfillment_status:unfulfilled` },
    maxPages: 6,
  });
  return nodes.filter((o) => !o.cancelledAt && o.shippingAddress?.address1);
}

function toLb(value: number, unit: string): number {
  switch (unit.toUpperCase()) {
    case "KILOGRAMS": return value * 2.20462;
    case "GRAMS": return value / 453.592;
    case "OUNCES": return value / 16;
    default: return value; // POUNDS
  }
}

// Sum the product weights Shopify knows about; fall back to the order's
// totalWeight (grams). 0 means Shopify has no weight data for this order.
function orderWeightLb(order: ShopifyOrderNode): number {
  let lb = 0;
  for (const item of order.lineItems.nodes) {
    if (!item.requiresShipping) continue;
    const w = item.variant?.inventoryItem?.measurement?.weight;
    if (w && w.value > 0) lb += toLb(w.value, w.unit) * item.quantity;
  }
  if (lb <= 0 && order.totalWeight && order.totalWeight > 0) lb = order.totalWeight / 453.592;
  return lb;
}

function orderDescription(order: ShopifyOrderNode): string {
  return (
    order.lineItems.nodes
      .filter((i) => i.requiresShipping)
      .map((i) => `${i.quantity}× ${i.title}`)
      .join(", ")
      .slice(0, 100) || "Order"
  );
}

/** Number of glass panels on the order, per the SKU/title conventions. */
export function countGlassUnits(order: ShopifyOrderNode, settings: ShippingQuoteSettings): number {
  const prefixes = settings.crate.glass_sku_prefixes.map((p) => p.toUpperCase()).filter(Boolean);
  const keywords = settings.crate.glass_title_keywords.map((k) => k.toLowerCase()).filter(Boolean);
  let units = 0;
  for (const item of order.lineItems.nodes) {
    if (!item.requiresShipping) continue;
    const sku = (item.variant?.sku ?? "").toUpperCase();
    const isGlass = sku
      ? prefixes.some((p) => sku.startsWith(p))
      : keywords.some((k) => item.title.toLowerCase().includes(k));
    if (isGlass) units += item.quantity;
  }
  return units;
}

/**
 * Crates for a glass order: ceil(glass / glass_per_crate) crates, the whole
 * order's product weight (hardware ships inside the crates) split evenly,
 * plus the empty-crate weight on each.
 */
export function buildCrates(
  order: ShopifyOrderNode,
  settings: ShippingQuoteSettings,
  glassUnits: number,
  freightClass: string,
): { crates: FreightcomPallet[]; weightSource: "shopify" | "default"; crateCount: number } {
  const c = settings.crate;
  const crateCount = Math.max(1, Math.ceil(glassUnits / Math.max(1, c.glass_per_crate)));
  const lb = orderWeightLb(order);
  const weightSource = lb > 0 ? "shopify" : "default";
  // No Shopify weights: assume the default box weight of cargo per crate
  // rather than inventing a per-panel figure.
  const cargo = lb > 0 ? lb : settings.default_package.weight_lb * crateCount;
  const per = Math.max(1, Math.round((cargo / crateCount + c.tare_lb) * 10) / 10);
  const description = orderDescription(order);
  const crates: FreightcomPallet[] = Array.from({ length: crateCount }, (_, i) => ({
    measurements: {
      weight: { unit: "lb", value: per },
      cuboid: { unit: "in", l: c.length_in, w: c.width_in, h: c.height_in },
    },
    description:
      crateCount > 1 ? `${description} (crate ${i + 1} of ${crateCount})`.slice(0, 100) : description,
    freight_class: freightClass,
    num_pieces: 1,
  }));
  return { crates, weightSource, crateCount };
}

export function buildPackages(
  order: ShopifyOrderNode,
  settings: ShippingQuoteSettings,
): { packages: FreightcomPackage[]; weightSource: "shopify" | "default" } {
  const dp = settings.default_package;
  const cuboid = { unit: "in" as const, l: dp.length_in, w: dp.width_in, h: dp.height_in };

  const lb = orderWeightLb(order);
  const weightSource = lb > 0 ? "shopify" : "default";
  const total = Math.max(1, Math.round((lb > 0 ? lb : dp.weight_lb) * 10) / 10);
  const description = orderDescription(order);

  // Carriers cap a single package (Freightcom rejects the request outright),
  // so heavy orders ship as several boxes of equal weight. This is still a
  // ballpark — the warehouse decides the real packing.
  const maxLb = settings.max_package_weight_lb;
  const count = Math.max(1, Math.ceil(total / maxLb));
  const per = Math.max(1, Math.round((total / count) * 10) / 10);
  const packages: FreightcomPackage[] = Array.from({ length: count }, (_, i) => ({
    measurements: { weight: { unit: "lb", value: per }, cuboid },
    description: count > 1 ? `${description} (${i + 1} of ${count})`.slice(0, 100) : description,
  }));

  return { packages, weightSource };
}

function digits(phone: string | null | undefined): string | undefined {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : undefined;
}

export function buildDestination(order: ShopifyOrderNode): FreightcomLocation {
  const a = order.shippingAddress!;
  const address: FreightcomAddress = {
    address_line_1: a.address1 ?? "",
    address_line_2: a.address2 ?? undefined,
    city: a.city ?? "",
    region: a.provinceCode ?? "",
    country: a.countryCodeV2 ?? "",
    postal_code: a.zip ?? "",
  };
  const phone = digits(a.phone) ?? digits(order.phone);
  return {
    name: a.company || a.name || order.customer?.displayName || "Customer",
    contact_name: a.name ?? undefined,
    address,
    residential: !a.company,
    phone_number: phone ? { number: phone } : undefined,
    email_addresses: order.email ? [order.email] : undefined,
  };
}

function buildOrigin(settings: ShippingQuoteSettings): FreightcomLocation {
  const o = settings.origin;
  const phone = digits(o.phone);
  return {
    name: o.name,
    contact_name: o.contact_name || undefined,
    address: {
      address_line_1: o.address_line_1,
      address_line_2: o.address_line_2 || undefined,
      city: o.city,
      region: o.region,
      country: o.country,
      postal_code: o.postal_code,
    },
    residential: false,
    phone_number: phone ? { number: phone } : undefined,
    // Freightcom requires an origin email for international rate requests.
    email_addresses: o.email ? [o.email] : undefined,
  };
}

function nextBusinessDay(): { year: number; month: number; day: number } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export interface BuiltRateRequest {
  request: FreightcomRateRequest;
  weightSource: "shopify" | "default";
  kind: "crate" | "parcel";
  // What lands in the shipping_quotes.packages column.
  stored: FreightcomPackage[] | FreightcomPallet[];
}

export function buildRateRequest(
  order: ShopifyOrderNode,
  settings: ShippingQuoteSettings,
  opts: { freightClass?: string } = {},
): BuiltRateRequest {
  const glassUnits = countGlassUnits(order, settings);
  const kind: BuiltRateRequest["kind"] = glassUnits > 0 ? "crate" : "parcel";

  let weightSource: "shopify" | "default";
  let stored: FreightcomPackage[] | FreightcomPallet[];
  let packaging: FreightcomRateRequest["details"]["packaging_properties"];
  let packagingType: "package" | "pallet";

  if (kind === "crate") {
    const built = buildCrates(order, settings, glassUnits, opts.freightClass ?? "70");
    weightSource = built.weightSource;
    stored = built.crates;
    packagingType = "pallet";
    packaging = { pallet_type: "ltl", pallets: built.crates, has_stackable_pallets: false };
  } else {
    const built = buildPackages(order, settings);
    weightSource = built.weightSource;
    stored = built.packages;
    packagingType = "package";
    packaging = { packages: built.packages, includes_return_label: false, has_dangerous_goods: false };
  }

  const destination = buildDestination(order);
  return {
    weightSource,
    kind,
    stored,
    request: {
      details: {
        origin: buildOrigin(settings),
        destination: {
          ...destination,
          ready_at: { hour: 9, minute: 0 },
          ready_until: { hour: 17, minute: 0 },
          signature_requirement: "not-required",
        },
        expected_ship_date: nextBusinessDay(),
        packaging_type: packagingType,
        packaging_properties: packaging,
        reference_codes: [order.name],
        shipment_classification: destination.residential ? "B2C" : "B2B",
      },
    },
  };
}

/**
 * Freight class for a glass order's crates, computed by Freightcom from the
 * crate's dims and weight. Falls back to class 70 if the calculator is
 * unavailable — a slightly-off class still returns usable LTL rates.
 */
export async function crateFreightClass(
  order: ShopifyOrderNode,
  settings: ShippingQuoteSettings,
  glassUnits: number,
): Promise<string> {
  try {
    const { crates } = buildCrates(order, settings, glassUnits, "70");
    return await calculateFreightClass(crates[0].measurements);
  } catch (err) {
    console.error("[shipping-quotes] freight-class calculate failed:", err instanceof Error ? err.message : err);
    return "70";
  }
}

export function shouldSkipMethod(title: string | null | undefined, settings: ShippingQuoteSettings): boolean {
  const t = (title ?? "").toLowerCase();
  return settings.skip_shipping_methods.some((m) => m && t.includes(m.toLowerCase()));
}

// ─── Persisted quotes ────────────────────────────────────────────────────────

export interface StoredRate {
  carrier: string;
  service: string;
  service_id: string;
  total: number | null;
  currency: string;
  transit_days: number | null;
  valid_until: string | null;
}

export interface ShippingQuoteRow {
  store_id: string;
  order_id: string;
  order_name: string;
  order_created_at: string;
  customer_name: string | null;
  shipping_method: string | null;
  destination: FreightcomLocation;
  // Parcel boxes, or LTL crates when the order contains glass (crate entries
  // carry a freight_class).
  packages: FreightcomPackage[] | FreightcomPallet[];
  weight_source: "shopify" | "default";
  status: "pending" | "quoted" | "no_rates" | "error";
  rate_request_id: string | null;
  cheapest: StoredRate | null;
  rates: StoredRate[] | null;
  error: string | null;
  requested_at: string | null;
  quoted_at: string | null;
  created_at: string;
  updated_at: string;
}

function toStored(rate: FreightcomRate): StoredRate {
  const v = rate.valid_until;
  return {
    carrier: rate.carrier_name,
    service: rate.service_name,
    service_id: rate.service_id,
    total: moneyToNumber(rate.total),
    currency: rate.total?.currency ?? "CAD",
    transit_days: rate.transit_time_not_available ? null : (rate.transit_time_days ?? null),
    valid_until: v ? `${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}` : null,
  };
}

/**
 * Asks Freightcom for rates on one order and writes the result. Never throws
 * for a carrier-side failure — the row records status 'error' so the page
 * can show what went wrong and offer a retry.
 */
export async function quoteOrder(
  storeId: string,
  order: ShopifyOrderNode,
  settings: ShippingQuoteSettings,
): Promise<ShippingQuoteRow["status"]> {
  const supabase = getSupabase();
  const glassUnits = countGlassUnits(order, settings);
  const freightClass =
    glassUnits > 0 ? await crateFreightClass(order, settings, glassUnits) : undefined;
  const { request, weightSource, stored } = buildRateRequest(order, settings, { freightClass });
  const now = new Date().toISOString();
  const base = {
    store_id: storeId,
    order_id: order.id,
    order_name: order.name,
    order_created_at: order.createdAt,
    customer_name: order.shippingAddress?.name || order.customer?.displayName || null,
    shipping_method: order.shippingLine?.title ?? null,
    destination: request.details.destination,
    packages: stored,
    weight_source: weightSource,
    requested_at: now,
    updated_at: now,
  };

  try {
    const requestId = await requestRate(request);
    const result = await waitForRate(requestId);
    const rates = result.rates.map(toStored);
    const best = cheapestRate(result.rates);
    const status: ShippingQuoteRow["status"] = rates.length > 0 ? "quoted" : "no_rates";
    const { error } = await supabase.from("shipping_quotes").upsert(
      {
        ...base,
        status,
        rate_request_id: requestId,
        cheapest: best ? toStored(best) : null,
        rates,
        error: rates.length > 0 ? null : "Freightcom returned no rates for this address/package",
        quoted_at: now,
      },
      { onConflict: "store_id,order_id" },
    );
    if (error) throw new Error(error.message);
    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("shipping_quotes").upsert(
      { ...base, status: "error", error: message.slice(0, 500) },
      { onConflict: "store_id,order_id" },
    );
    return "error";
  }
}

export interface ShippingQuoteSyncSummary {
  stores: number;
  scanned: number;
  quoted: number;
  errors: number;
  skipped: number;
  reason?: string;
}

/**
 * Cron entry point: quote every unfulfilled, shippable order that doesn't
 * already have a quote. Existing rows are left alone — a refresh is a
 * deliberate click on the page, not something that happens every 15 min.
 */
export async function syncShippingQuotes(opts: { maxQuotes?: number } = {}): Promise<ShippingQuoteSyncSummary> {
  const summary: ShippingQuoteSyncSummary = { stores: 0, scanned: 0, quoted: 0, errors: 0, skipped: 0 };
  if (!isFreightcomConfigured()) return { ...summary, reason: "FREIGHTCOM_API_KEY not set" };
  const settings = await getShippingQuoteSettings();
  if (!originIsComplete(settings)) return { ...summary, reason: "Origin address not set on the Shipping Quotes page" };

  const maxQuotes = opts.maxQuotes ?? 15;
  const supabase = getSupabase();

  for (const store of getStores()) {
    summary.stores++;
    let orders: ShopifyOrderNode[];
    try {
      orders = await fetchShippableOrders(store.id, settings.lookback_days);
    } catch (err) {
      console.error(`[shipping-quotes] ${store.label}:`, err instanceof Error ? err.message : err);
      summary.errors++;
      continue;
    }
    summary.scanned += orders.length;
    if (orders.length === 0) continue;

    const { data: existing } = await supabase
      .from("shipping_quotes")
      .select("order_id")
      .eq("store_id", store.id)
      .in("order_id", orders.map((o) => o.id));
    const have = new Set((existing ?? []).map((r) => r.order_id as string));

    for (const order of orders) {
      if (have.has(order.id)) continue;
      if (summary.quoted + summary.errors >= maxQuotes) break;
      if (shouldSkipMethod(order.shippingLine?.title, settings)) {
        summary.skipped++;
        continue;
      }
      const status = await quoteOrder(store.id, order, settings);
      if (status === "error") summary.errors++;
      else summary.quoted++;
    }
  }
  return summary;
}

export async function requoteOrder(storeId: string, orderId: string): Promise<ShippingQuoteRow["status"]> {
  if (!isFreightcomConfigured()) throw new Error("FREIGHTCOM_API_KEY is not set");
  const settings = await getShippingQuoteSettings();
  if (!originIsComplete(settings)) throw new Error("Set the origin address first");
  const { nodes } = await fetchAllPages<ShopifyOrderNode, OrdersData>({
    storeId,
    query: ORDERS_QUERY,
    getConnection: (data) => data.orders,
    variables: { search: `id:${orderId.split("/").pop()}` },
    maxPages: 1,
  });
  const order = nodes.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found in Shopify");
  if (!order.shippingAddress?.address1) throw new Error("Order has no shipping address");
  return quoteOrder(storeId, order, settings);
}

export async function listShippingQuotes(opts: { days?: number } = {}): Promise<ShippingQuoteRow[]> {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from("shipping_quotes")
    .select("*")
    .gte("order_created_at", since)
    .order("order_created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as ShippingQuoteRow[];
}
