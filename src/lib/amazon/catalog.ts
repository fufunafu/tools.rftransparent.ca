import "server-only";
import { shopifyGraphQL } from "@/lib/shopify";
import { AmazonError, type ProductSource } from "./domain";

export const HARDWARE_STORE_ID = "store2";
// Reviewed against the Glass Railing Store catalog on October 3, 2026.
// Explicit inclusion keeps glass panels, custom glass, and mixed sample kits out.
export const HARDWARE_PRODUCTS = new Set([
  "7931790721209", // Engineered spigot
  "7931791016121", "7931791048889", "7931791114425", "7931791179961", // Connectors
  "7931791212729", // Hinge kit
  "7931791245497", "7931808579769", "7931808743609", // Gate latches
  "7931808841913", "7931809005753", "7931809497273", // Floor lock, screws, fascia spigot
  "8015888285881", "8015893332153", "8015893659833", "8015894118585", // Caprail and fittings
  "8280823038137", "8280823070905", // Caprail rubber
  "8666580615353", "8666601324729", "8666602537145", // Long caprail and adjustable connectors
].map((id) => `gid://shopify/Product/${id}`));

export async function ensureHardwareVariant(sourceVariantId: string) {
  const data = await shopifyGraphQL<{ productVariant: { product: { id: string; status: string } } | null }>(HARDWARE_STORE_ID,
    "query AmazonHardwareSource($id: ID!) { productVariant(id: $id) { product { id status } } }", { id: sourceVariantId });
  if (!data.productVariant || data.productVariant.product.status !== "ACTIVE" || !HARDWARE_PRODUCTS.has(data.productVariant.product.id)) {
    throw new AmazonError("Only approved Glass Railing Store hardware can be uploaded. Glass panels and sample kits are excluded.");
  }
}

export const CATALOG_QUERY = `query AmazonCatalog($after: String, $query: String) {
  productVariants(first: 40, after: $after, query: $query) {
    nodes {
      id title sku barcode inventoryQuantity
      image { url }
      contextualPricing(context: { country: US }) { price { amount currencyCode } }
      product { id title description vendor status featuredImage { url } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface CatalogResponse {
  productVariants: {
    nodes: { id: string; title: string; sku: string | null; barcode: string | null; inventoryQuantity: number | null;
      image: { url: string } | null;
      contextualPricing: { price: { amount: string; currencyCode: string } };
      product: { id: string; title: string; description: string; vendor: string; status: string; featuredImage: { url: string } | null };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
export async function loadCatalog(storeId: string, search: string, after?: string) {
  if (storeId !== HARDWARE_STORE_ID) throw new AmazonError("Use the Glass Railing Store hardware catalog.");
  // Shopify's query language is intentional here and remains read-only.
  const hardwareQuery = [...HARDWARE_PRODUCTS].map((id) => `product_id:${id.split("/").at(-1)}`).join(" OR ");
  const query = `(${hardwareQuery})${search.trim() ? ` AND (${search.trim()})` : ""}`;
  const data = await shopifyGraphQL<CatalogResponse>(storeId, CATALOG_QUERY, { after: after || null, query });
  const items: ProductSource[] = data.productVariants.nodes.filter((variant) => variant.product.status === "ACTIVE" && HARDWARE_PRODUCTS.has(variant.product.id)).map((variant) => ({
    id: variant.id, sku: variant.sku ?? "", barcode: variant.barcode ?? "", brand: variant.product.vendor,
    title: variant.product.title + (variant.title === "Default Title" ? "" : ` - ${variant.title}`),
    description: variant.product.description,
    image: variant.image?.url ?? variant.product.featuredImage?.url ?? "",
    price: variant.contextualPricing.price.amount, currency: variant.contextualPricing.price.currencyCode,
    inventory: variant.inventoryQuantity,
  }));
  return { items, ...data.productVariants.pageInfo };
}
