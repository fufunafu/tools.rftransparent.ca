import { describe, expect, it } from "vitest";
import { matchSalesLine, salesSourceKey, type SalesLine, type SalesProduct } from "./sales-matching";
const products: SalesProduct[] = [
  { id: "glass", sku: "GP34X57.7", name: "Glass", category: "glass", height: 33.6, width: 57.7 },
  { id: "side", sku: "SP-SM-SS", name: "Side mount", category: "hardware", height: null, width: null },
  { id: "connector", sku: "CN180-S-BL", name: "Connector", category: "hardware", height: null, width: null },
];
const line = (title: string, variantTitle: string | null = null, sku: string | null = null): SalesLine => ({ id: "1", title, variantTitle, sku, quantity: 3, currentQuantity: 2, variant: null, product: null });
describe("historical purchasing matches", () => {
  it("consolidates recreated listings with a case-insensitive SKU", () => {
    expect(matchSalesLine(line("An older name", null, "gp34x57.7"), products)).toMatchObject({ product_id: "glass", method: "sku" });
  });
  it("recovers historic SKU-less side mounts and specific connectors", () => {
    expect(matchSalesLine(line("Side Mount / Fascia Spigot", "Brushed Stainless"), products).product_id).toBe("side");
    expect(matchSalesLine(line("180 Connector, small, matte black"), products).product_id).toBe("connector");
  });
  it("uses explicit specifications when a historical SKU names the wrong finish", () => {
    const black = { ...products[1], id: "black-side", sku: "SP-SM-BL" };
    expect(matchSalesLine(line("Side Mount / Fascia Spigot", "Matte Black", "SP-SM-SS"), [...products, black])).toMatchObject({ product_id: "black-side", method: "specification" });
    expect(matchSalesLine(line("Unknown item", "Matte Black", "SP-SM-SS"), products).method).toBe("review");
  });
  it("requires finish and connector size", () => {
    expect(matchSalesLine(line("180 Connector", "Black"), products).method).toBe("review");
    expect(matchSalesLine(line("Side Mount Spigot"), products).method).toBe("review");
  });
  it("normalizes nominal heights and allows rotated plain rectangular panels", () => {
    expect(matchSalesLine(line('34" High Tempered Glass Panels 12mm', '57.7"'), products).product_id).toBe("glass");
    expect(matchSalesLine(line('57.7" High Tempered Glass Panels 12mm (total railing height is 60")', '33.6"'), products).product_id).toBe("glass");
  });
  it("does not merge custom, holed, different thickness, bundles, returns, or vague dimensions", () => {
    for (const title of ['Custom Glass 34" x 57.7"', '34" Tempered Glass Panels 10mm 57.7"', 'Gate Support Panels 34" x 57.7"', 'Return: 180 Connector small black', 'Bundle of 180 Connector small black']) {
      expect(matchSalesLine(line(title), products).product_id).toBeNull();
    }
    expect(matchSalesLine(line('34" Tempered Glass Panels 12mm', '57.8"'), products).product_id).toBeNull();
  });
  it("keeps changed title and SKU evidence distinct within a store", () => {
    expect(salesSourceKey("store1", line("Old"))).not.toBe(salesSourceKey("store1", line("New")));
    expect(salesSourceKey("store1", line("Old"))).not.toBe(salesSourceKey("store2", line("Old")));
  });
});
