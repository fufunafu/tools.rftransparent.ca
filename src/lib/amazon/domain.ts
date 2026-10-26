import { z } from "zod";

export const AMAZON_US = "ATVPDKIKX0DER";
export type Attributes = Record<string, unknown[]>;
export interface ProductSource {
  id: string;
  title: string;
  sku: string;
  brand: string;
  description: string;
  barcode: string;
  image: string;
  price: string;
  currency: string;
  inventory: number | null;
}
export interface ListingDraft {
  sourceVariantId: string;
  sku: string;
  productType: string;
  attributes: Attributes;
}
export interface ListingIssue {
  code: string;
  message: string;
  severity: string;
  attributeNames?: string[];
}
export interface ListingResult {
  sku: string;
  status: string;
  submissionId?: string;
  issues?: ListingIssue[];
}
export interface ProductSchema {
  title?: string;
  description?: string;
  type?: string | string[];
  enum?: (string | number | boolean)[];
  enumNames?: string[];
  const?: unknown;
  default?: unknown;
  properties?: Record<string, ProductSchema>;
  items?: ProductSchema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  $ref?: string;
  $defs?: Record<string, ProductSchema>;
}

export const draftSchema = z.object({
  sourceVariantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  sku: z.string().trim().min(1).max(40).refine((value) => !/[\u0000-\u001f]/.test(value), "Invalid SKU"),
  productType: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/), z.array(z.unknown()).min(1).max(100)),
}).strict();

export class AmazonError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function canSubmit(result: ListingResult): boolean {
  return result.status === "VALID" && !(result.issues ?? []).some((issue) => issue.severity === "ERROR");
}

export function sourceToDraft(source: ProductSource): ListingDraft {
  const localized = (value: string) => [{ value, language_tag: "en_US", marketplace_id: AMAZON_US }];
  const attributes: Attributes = {
    item_name: localized(source.title),
    condition_type: [{ value: "new_new", marketplace_id: AMAZON_US }],
    // Stock is allocated explicitly for Amazon, never copied across sales channels.
    fulfillment_availability: [{ fulfillment_channel_code: "DEFAULT", quantity: 0 }],
  };
  if (source.brand) attributes.brand = [{ value: source.brand, marketplace_id: AMAZON_US }];
  if (source.description) attributes.product_description = localized(source.description);
  if (source.image) attributes.main_product_image_locator = [{ media_location: source.image, marketplace_id: AMAZON_US }];
  const barcodeType = ({ 12: "upc", 13: "ean", 14: "gtin" } as Record<number, string>)[source.barcode.length];
  if (/^\d+$/.test(source.barcode) && barcodeType) {
    attributes.externally_assigned_product_identifier = [{ type: barcodeType, value: source.barcode, marketplace_id: AMAZON_US }];
  }
  if (source.currency === "USD" && Number(source.price) > 0) {
    attributes.purchasable_offer = [{ currency: "USD", marketplace_id: AMAZON_US, our_price: [{ schedule: [{ value_with_tax: Number(source.price) }] }] }];
  }
  return { sourceVariantId: source.id, sku: source.sku, productType: "", attributes };
}

export function resolveSchema(schema: ProductSchema, root: ProductSchema): ProductSchema {
  if (!schema.$ref?.startsWith("#/$defs/")) return schema;
  const definition = root.$defs?.[schema.$ref.slice(8)];
  return definition ? { ...definition, ...schema, $ref: undefined } : schema;
}

export function emptyValue(schema: ProductSchema, root: ProductSchema, depth = 0): unknown {
  if (depth > 12) return undefined;
  const field = resolveSchema(schema, root);
  if (field.const !== undefined) return field.const;
  if (field.type === "object" || field.properties) {
    return Object.fromEntries(Object.entries(field.properties ?? {}).flatMap(([key, child]) => {
      if (key === "marketplace_id") return [[key, AMAZON_US]];
      if (key === "language_tag") return [[key, "en_US"]];
      const resolved = resolveSchema(child, root);
      return resolved.const !== undefined ? [[key, resolved.const]] : [];
    }));
  }
  if (field.type === "array") return [emptyValue(field.items ?? {}, root, depth + 1)];
  // Do not guess compliance answers, brands, countries, prices, or exemptions.
  return undefined;
}
