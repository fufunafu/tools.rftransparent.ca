import { describe, expect, it } from "vitest";
import {
  buildDestination,
  buildPackages,
  buildRateRequest,
  countGlassUnits,
  SHIPPING_QUOTE_DEFAULTS,
  shouldSkipMethod,
} from "@/lib/shipping-quotes";
import type { FreightcomPallet } from "@/lib/freightcom";
import { cheapestRate } from "@/lib/freightcom";

const settings = {
  ...SHIPPING_QUOTE_DEFAULTS,
  origin: {
    ...SHIPPING_QUOTE_DEFAULTS.origin,
    address_line_1: "1 Glass St",
    city: "Toronto",
    postal_code: "M5V 1A1",
    phone: "+1 (416) 555-0100",
    email: "warehouse@example.com",
  },
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-08-28T12:00:00Z",
    cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED",
    email: "buyer@example.com",
    phone: null,
    totalWeight: 0,
    customer: { displayName: "Sam Buyer" },
    shippingAddress: {
      name: "Sam Buyer",
      company: null,
      address1: "22 Elm Ave",
      address2: null,
      city: "Ottawa",
      provinceCode: "ON",
      countryCodeV2: "CA",
      zip: "K1A 0B1",
      phone: "613-555-0199",
    },
    shippingLine: { title: "Standard Shipping", code: "std" },
    lineItems: { nodes: [] },
    ...overrides,
  } as Parameters<typeof buildPackages>[0];
}

describe("buildPackages", () => {
  it("falls back to the default box when Shopify has no weights", () => {
    const { packages, weightSource } = buildPackages(order(), settings);
    expect(weightSource).toBe("default");
    expect(packages[0].measurements.weight).toEqual({ unit: "lb", value: 30 });
    expect(packages[0].measurements.cuboid).toEqual({ unit: "in", l: 48, w: 12, h: 12 });
  });

  it("sums product weights across quantities and converts kg to lb", () => {
    const o = order({
      lineItems: {
        nodes: [
          { title: "Post", quantity: 2, requiresShipping: true, variant: { sku: "P1", inventoryItem: { measurement: { weight: { value: 5, unit: "KILOGRAMS" } } } } },
          { title: "Service", quantity: 1, requiresShipping: false, variant: { sku: "S1", inventoryItem: { measurement: { weight: { value: 99, unit: "POUNDS" } } } } },
        ],
      },
    });
    const { packages, weightSource } = buildPackages(o, settings);
    expect(weightSource).toBe("shopify");
    expect(packages[0].measurements.weight.value).toBeCloseTo(22.0, 1);
    expect(packages[0].description).toBe("2× Post");
  });

  it("splits orders heavier than the per-package max into equal boxes", () => {
    const o = order({
      lineItems: {
        nodes: [
          { title: "Glass panel", quantity: 4, requiresShipping: true, variant: { sku: "G1", inventoryItem: { measurement: { weight: { value: 100, unit: "POUNDS" } } } } },
        ],
      },
    });
    const { packages } = buildPackages(o, settings); // 400 lb, max 150
    expect(packages).toHaveLength(3);
    expect(packages[0].measurements.weight.value).toBeCloseTo(133.3, 1);
    expect(packages[0].description).toContain("(1 of 3)");
    expect(packages[2].description).toContain("(3 of 3)");
  });

  it("uses Shopify totalWeight (grams) when line items carry no weight", () => {
    const { packages, weightSource } = buildPackages(order({ totalWeight: 4536 }), settings);
    expect(weightSource).toBe("shopify");
    expect(packages[0].measurements.weight.value).toBe(10);
  });
});

describe("buildDestination / buildRateRequest", () => {
  it("marks residential when there is no company and keeps a 10-digit phone", () => {
    const dest = buildDestination(order());
    expect(dest.residential).toBe(true);
    expect(dest.phone_number).toEqual({ number: "6135550199" });
    expect(dest.address.region).toBe("ON");
  });

  it("builds a package-type request from the configured origin", () => {
    const { request } = buildRateRequest(order(), settings);
    expect(request.details.packaging_type).toBe("package");
    expect(request.details.origin.address.postal_code).toBe("M5V 1A1");
    expect(request.details.origin.phone_number).toEqual({ number: "4165550100" });
    expect(request.details.origin.email_addresses).toEqual(["warehouse@example.com"]);
    expect(request.details.destination.signature_requirement).toBe("not-required");
    expect(request.details.reference_codes).toEqual(["#1001"]);
    expect(request.details.shipment_classification).toBe("B2C");
  });
});

describe("crate shipping for glass orders", () => {
  const glassItem = (qty: number, lbEach = 50) => ({
    title: "Glass Panel 40x61",
    quantity: qty,
    requiresShipping: true,
    variant: { sku: "GP40X61", inventoryItem: { measurement: { weight: { value: lbEach, unit: "POUNDS" } } } },
  });
  const hardwareItem = {
    title: "Spigot SS",
    quantity: 10,
    requiresShipping: true,
    variant: { sku: "SP-SS", inventoryItem: { measurement: { weight: { value: 2, unit: "POUNDS" } } } },
  };

  it("counts glass by SKU prefix, ignoring hardware", () => {
    const o = order({ lineItems: { nodes: [glassItem(20), hardwareItem] } });
    expect(countGlassUnits(o, settings)).toBe(20);
  });

  it("falls back to title keywords when the item has no SKU", () => {
    const o = order({
      lineItems: { nodes: [{ title: "Custom Glass Panel", quantity: 3, requiresShipping: true, variant: null }] },
    });
    expect(countGlassUnits(o, settings)).toBe(3);
  });

  it("quotes glass orders as LTL crates: 20 glass -> 2 crates, hardware inside", () => {
    const o = order({ lineItems: { nodes: [glassItem(20), hardwareItem] } });
    const built = buildRateRequest(o, settings, { freightClass: "65" });
    expect(built.kind).toBe("crate");
    expect(built.request.details.packaging_type).toBe("pallet");
    const props = built.request.details.packaging_properties as {
      pallet_type: string;
      pallets: FreightcomPallet[];
    };
    expect(props.pallet_type).toBe("ltl");
    expect(props.pallets).toHaveLength(2);
    // (20×50 lb glass + 10×2 lb hardware) / 2 crates + 80 lb tare = 590 each
    expect(props.pallets[0].measurements.weight.value).toBeCloseTo(590, 0);
    expect(props.pallets[0].freight_class).toBe("65");
    expect(props.pallets[0].measurements.cuboid).toEqual({ unit: "in", l: 72, w: 30, h: 48 });
  });

  it("caps oversized-crate requests at 4 pallets (5+ pallets must be under 48 in long)", () => {
    // 100 glass × 50 lb = 7 real crates of 72 in — capped at 4 per request.
    const o = order({ lineItems: { nodes: [glassItem(100)] } });
    const built = buildRateRequest(o, settings, { freightClass: "70" });
    const pallets = built.stored as FreightcomPallet[];
    expect(pallets).toHaveLength(4);
    // 5000 lb / 4 crates + 80 tare = 1330 each — total weight preserved.
    expect(pallets[0].measurements.weight.value).toBeCloseTo(1330, 0);
    expect(pallets[0].description).toContain("actually 7 crates, quoted as 4");
  });

  it("short crates may go up to Freightcom's 6-pallet maximum", () => {
    const shortCrates = { ...settings, crate: { ...settings.crate, length_in: 40 } };
    const o = order({ lineItems: { nodes: [glassItem(100)] } });
    const built = buildRateRequest(o, shortCrates, { freightClass: "70" });
    expect((built.stored as FreightcomPallet[]).length).toBe(6);
  });

  it("falls back to the warehouse email when the order has none (international rating)", () => {
    const o = order({ email: null, lineItems: { nodes: [glassItem(3)] } });
    const built = buildRateRequest(o, settings, { freightClass: "70" });
    expect(built.request.details.destination.email_addresses).toEqual(["warehouse@example.com"]);
  });

  it("3 glass is still one crate; hardware-only orders stay parcels", () => {
    const glass = order({ lineItems: { nodes: [glassItem(3)] } });
    const glassBuilt = buildRateRequest(glass, settings, { freightClass: "70" });
    expect(glassBuilt.kind).toBe("crate");
    expect((glassBuilt.stored as FreightcomPallet[]).length).toBe(1);

    const hardware = order({ lineItems: { nodes: [hardwareItem] } });
    const hardwareBuilt = buildRateRequest(hardware, settings);
    expect(hardwareBuilt.kind).toBe("parcel");
    expect(hardwareBuilt.request.details.packaging_type).toBe("package");
  });
});

describe("shouldSkipMethod", () => {
  it("skips pickup-style shipping methods, case-insensitively", () => {
    expect(shouldSkipMethod("Local Pickup — Mississauga", settings)).toBe(true);
    expect(shouldSkipMethod("Standard Shipping", settings)).toBe(false);
    expect(shouldSkipMethod(null, settings)).toBe(false);
  });
});

describe("cheapestRate", () => {
  it("picks the lowest total and ignores unparsable values", () => {
    const best = cheapestRate([
      { carrier_name: "A", service_name: "x", service_id: "1", total: { currency: "CAD", value: "4500" } },
      { carrier_name: "B", service_name: "y", service_id: "2", total: { currency: "CAD", value: "3999" } },
      { carrier_name: "C", service_name: "z", service_id: "3", total: { currency: "CAD", value: "oops" } },
    ]);
    expect(best?.carrier_name).toBe("B");
  });
});
