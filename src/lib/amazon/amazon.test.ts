import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));
import { shopifyGraphQL } from "@/lib/shopify";
import { AmazonClient } from "./client";
import { ensureHardwareVariant, loadCatalog } from "./catalog";
import { canSubmit, emptyValue, sourceToDraft, type ProductSource } from "./domain";
import { signPreview, verifyPreview } from "./preview";

const source: ProductSource = { id: "gid://shopify/ProductVariant/123", sku: "SP-SS", title: "Spigot", brand: "Brand", barcode: "123456789012", description: "Hardware", image: "https://cdn.shopify.com/test.jpg", price: "75.00", currency: "USD", inventory: 500 };
const draft = { ...sourceToDraft(source), productType: "HARDWARE" };
beforeEach(() => {
  for (const key of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "SELLER_ID"]) vi.stubEnv(`AMAZON_SP_API_${key}`, `test-${key}`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("product mapping", () => {
  it("uses USD market pricing but never allocates Shopify stock automatically", () => {
    expect(draft.attributes.purchasable_offer).toMatchObject([{ currency: "USD", our_price: [{ schedule: [{ value_with_tax: 75 }] }] }]);
    expect(draft.attributes.fulfillment_availability).toEqual([{ fulfillment_channel_code: "DEFAULT", quantity: 0 }]);
  });
  it("never labels a CAD price as USD or invents a missing barcode or exemption", () => {
    const mapped = sourceToDraft({ ...source, currency: "CAD", barcode: "" });
    expect(mapped.attributes.purchasable_offer).toBeUndefined();
    expect(mapped.attributes.externally_assigned_product_identifier).toBeUndefined();
    expect(mapped.attributes.supplier_declared_has_product_identifier_exemption).toBeUndefined();
  });
  it("does not default compliance answers", () => {
    expect(emptyValue({ type: "boolean", default: true }, {})).toBeUndefined();
    expect(emptyValue({ type: "string", enum: ["US", "CN"] }, {})).toBeUndefined();
  });
  it("only treats VALID previews without errors as uploadable", () => {
    expect(canSubmit({ sku: "a", status: "VALID", issues: [] })).toBe(true);
    expect(canSubmit({ sku: "a", status: "ACCEPTED" })).toBe(false);
    expect(canSubmit({ sku: "a", status: "VALID", issues: [{ code: "1", severity: "ERROR", message: "Missing field" }] })).toBe(false);
  });
});

describe("preview authorization", () => {
  it("binds upload permission to the seller, actor, exact draft, and expiration", () => {
    const receipt = signPreview(draft, "owner", 1000);
    expect(() => verifyPreview(receipt, draft, "owner", 1001)).not.toThrow();
    expect(() => verifyPreview(receipt, { ...draft, sku: "another" }, "owner", 1001)).toThrow();
    expect(() => verifyPreview(receipt, draft, "employee", 1001)).toThrow();
    expect(() => verifyPreview(receipt, draft, "owner", 901000)).toThrow();
    expect(() => verifyPreview(receipt + "tampered", draft, "owner", 1001)).toThrow();
    vi.stubEnv("AMAZON_SP_API_SELLER_ID", "other-seller");
    expect(() => verifyPreview(receipt, draft, "owner", 1001)).toThrow();
  });
  it("accepts reordered object keys but rejects price or stock changes", () => {
    const receipt = signPreview(draft, "owner");
    expect(() => verifyPreview(receipt, { ...draft, attributes: Object.fromEntries(Object.entries(draft.attributes).reverse()) }, "owner")).not.toThrow();
    expect(() => verifyPreview(receipt, { ...draft, attributes: { ...draft.attributes, fulfillment_availability: [{ quantity: 100 }] } }, "owner")).toThrow();
  });
});

describe("Amazon transport", () => {
  it("uses validation preview and keeps source IDs out of the Amazon payload", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret-token" })).mockResolvedValueOnce(Response.json({ sku: "SP-SS", status: "VALID" }));
    vi.stubGlobal("fetch", fetcher);
    await new AmazonClient().put(draft, true);
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toContain("mode=VALIDATION_PREVIEW");
    expect(url).toContain("marketplaceIds=ATVPDKIKX0DER");
    expect(options.headers["x-amz-access-token"]).toBe("secret-token");
    expect(JSON.parse(options.body)).toEqual({ productType: "HARDWARE", attributes: draft.attributes, requirements: "LISTING" });
  });
  it("fails closed on auth errors instead of treating an existing-listing check as absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret" })).mockResolvedValueOnce(new Response("forbidden", { status: 403 })));
    await expect(new AmazonClient().ensureNew("SP-SS")).rejects.toThrow("denied access");
  });
  it("blocks overwrites and recognizes only 404 as a missing listing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret" })).mockResolvedValueOnce(Response.json({ sku: "SP-SS" })).mockResolvedValueOnce(new Response("missing", { status: 404 })));
    const client = new AmazonClient();
    await expect(client.ensureNew("SP-SS")).rejects.toThrow("already exists");
    await expect(client.ensureNew("new")).resolves.toBeUndefined();
  });
  it("does not expose Amazon token error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret refresh-token", { status: 400 })));
    await expect(new AmazonClient().put(draft, true)).rejects.toThrow("authorization failed");
  });
});

describe("hardware scope", () => {
  it("rejects other stores and glass variants at the server boundary", async () => {
    await expect(loadCatalog("store1", "")).rejects.toThrow("Glass Railing Store");
    vi.mocked(shopifyGraphQL).mockResolvedValue({ productVariant: { product: { id: "gid://shopify/Product/7931790753977", status: "ACTIVE" } } });
    await expect(ensureHardwareVariant(source.id)).rejects.toThrow("Only approved");
    vi.mocked(shopifyGraphQL).mockResolvedValue({ productVariant: { product: { id: "gid://shopify/Product/7931790721209", status: "ACTIVE" } } });
    await expect(ensureHardwareVariant(source.id)).resolves.toBeUndefined();
  });
  it("filters glass, mixed sample kits, and inactive hardware while preserving pagination", async () => {
    const variant = { id: source.id, title: "Default Title", sku: "SP-SS", barcode: null, inventoryQuantity: 10, image: null, contextualPricing: { price: { amount: "75", currencyCode: "USD" } }, product: { id: "gid://shopify/Product/7931790721209", title: "Spigot", description: "", vendor: "Brand", status: "ACTIVE", featuredImage: null } };
    vi.mocked(shopifyGraphQL).mockResolvedValue({ productVariants: { nodes: [variant,
      { ...variant, product: { ...variant.product, id: "gid://shopify/Product/7931790753977" } },
      { ...variant, product: { ...variant.product, id: "gid://shopify/Product/8720769908921" } },
      { ...variant, product: { ...variant.product, status: "DRAFT" } },
    ], pageInfo: { hasNextPage: true, endCursor: "next" } } });
    const data = await loadCatalog("store2", "spigot");
    expect(data.items).toHaveLength(1);
    expect(data.hasNextPage).toBe(true);
    expect(data.endCursor).toBe("next");
  });
});
