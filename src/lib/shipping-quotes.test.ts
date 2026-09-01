import { describe, expect, it } from "vitest";
import {
  buildDestination,
  buildPackages,
  buildRateRequest,
  SHIPPING_QUOTE_DEFAULTS,
  shouldSkipMethod,
} from "@/lib/shipping-quotes";
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
