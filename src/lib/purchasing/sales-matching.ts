import { createHash } from "node:crypto";

export interface SalesProduct { id: string; sku: string; name: string; category: string; height: number | null; width: number | null }
export interface SalesLine {
  id: string; sku: string | null; title: string; variantTitle: string | null;
  quantity: number; currentQuantity: number;
  variant: { id: string } | null; product: { id: string } | null;
}
export interface SalesMatch { product_id: string | null; method: "sku" | "specification" | "review" | "outside_catalog"; reason: string }
export function salesSourceKey(store: string, line: SalesLine): string {
  return createHash("sha256").update(JSON.stringify([store, line.variant?.id ?? null, line.sku ?? "", line.title, line.variantTitle ?? ""])).digest("hex");
}
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[”“″]/g, '"').replace(/\s+/g, " ").trim();
const skuKey = (s: string) => s.trim().toUpperCase();

/** Deliberately requires distinguishing specifications. Similar words alone never merge stock. */
function matchSalesSpecifications(line: SalesLine, products: SalesProduct[]): SalesMatch {
  const text = norm(`${line.title} ${line.variantTitle ?? ""}`);
  const review = (reason: string): SalesMatch => ({ product_id: null, method: "review", reason });
  const outside = (reason: string): SalesMatch => ({ product_id: null, method: "outside_catalog", reason });
  // Returns entered as custom positive line items must not inflate demand.
  if (/\b(return|refund|credit|exchange|replacement)\b/.test(text)) return review("Return, credit, or replacement wording needs review");
  if (/\b(custom|laminated|lamination|lami|stair|stairglass|notch|frosted|holed|holes|gate panels?|gate support|caprail|handrail|screw|bracket|rubber|crate|shipping|standoff|sample)\b/.test(text)) {
    return outside("Product or service is outside the current purchasing catalog");
  }
  if (/\b(pack|bundle|railing kit|set of|pair)\b/.test(text)) return review("Pack or kit needs a confirmed unit conversion");
  let target: string | null = null;
  if (/glass|tempered|panel/.test(text) && !/connector|latch|hinge/.test(text)) {
    const clean = text.replace(/\([^)]*railing height[^)]*\)/g, "");
    // Only ordinary 12 mm tempered rectangular panels are inferred by dimensions.
    if (!/tempered/.test(clean) || !/12\s*mm/.test(clean)) return review("Glass thickness and type must be confirmed");
    const numbers = [...clean.matchAll(/(\d+(?:\.\d+)?)\s*"/g)].map(m => Number(m[1]));
    if (numbers.length !== 2) return review("Glass height and width are not unambiguous");
    const heightEquals = (actual: number, value: number) => Math.abs(actual - value) < 0.06 || (actual === 33.6 && value === 34) || (actual === 39.6 && value === 40);
    const matches = products.filter(p => p.category === "glass" && p.height != null && p.width != null &&
      ((heightEquals(Number(p.height), numbers[0]) && Math.abs(Number(p.width) - numbers[1]) < 0.06) ||
       (heightEquals(Number(p.height), numbers[1]) && Math.abs(Number(p.width) - numbers[0]) < 0.06)));
    if (matches.length === 1) return { product_id: matches[0].id, method: "specification", reason: "12 mm tempered panel with matching dimensions; nominal 34/40 inch heights normalized" };
    return review("Panel dimensions do not identify one purchasing SKU");
  }
  const variant = norm(line.variantTitle ?? "");
  const finishText = /\b(black|mb|stainless|brushed|ss)\b/.test(variant) ? variant : text;
  const black = /\b(black|mb)\b/.test(finishText);
  const stainless = /\b(stainless|brushed|ss)\b/.test(finishText);
  const finish = black !== stainless ? (black ? "BL" : "SS") : null;
  if (/\b(cover|covers|cap|caps|bolt|bolts|insert|inserts|plate|plates)\b/.test(text)) return outside("Accessory is not the complete purchasing product");
  if (/spigot|connector|latch|hinge|floor lock/.test(text)) {
    if (!finish) return review("Finish is missing or conflicting");
    if (/spigot/.test(text)) {
      if (/side\s*mount|sidemount|fascia/.test(text)) target = `SP-SM-${finish}`;
      else if (/6\s*"|engineered/.test(text)) target = `SP-${finish}`;
    } else if (/connector/.test(text)) {
      const size = /\bsmall\b/.test(text) ? "S" : /\b(big|large)\b/.test(text) ? "B" : null;
      const angles = [ [/\b180\b/, "180"], [/\b90\b/, "90"], [/\bwall\b/, "WALL"], [/\badjustable\b/, "ADJ"] ] as const;
      const types = angles.filter(([re]) => re.test(text));
      if (size && types.length === 1) target = `CN${types[0][1]}-${size}-${finish}`;
    } else if (/floor lock/.test(text)) target = `FL-${finish}`;
    else if (/latch/.test(text)) {
      if (/wall/.test(text)) target = `GTLWALL-${finish}`;
      else {
        const angle = /\b180\b/.test(text) ? "180" : /\b90\b/.test(text) ? "90" : null;
        const model = text.match(/model\s*([12])\b/)?.[1];
        if (angle && model) target = `GTL${angle}-${model}-${finish}`;
      }
    } else if (/hinge/.test(text) && /kit/.test(text)) {
      const mount = /wall/.test(text) ? "WALL" : /\b180\b|glass mount|straight/.test(text) ? "180" : null;
      if (mount) target = `HKIT-${mount}-${finish}`;
    }
    const matches = products.filter(p => p.sku.toUpperCase() === target);
    if (matches.length === 1) return { product_id: matches[0].id, method: "specification", reason: "Matching hardware type, finish, size, and mounting specifications" };
    return review("Hardware specifications do not identify one purchasing SKU");
  }
  return outside("No equivalent product in the current purchasing catalog");
}


export function matchSalesLine(line: SalesLine, products: SalesProduct[]): SalesMatch {
  const inferred = matchSalesSpecifications(line, products);
  const exact = products.filter(p => line.sku && skuKey(p.sku) === skuKey(line.sku));
  if (exact.length !== 1) return exact.length > 1 ? { product_id: null, method: "review", reason: "Duplicate purchasing SKU" } : inferred;
  const text = norm(`${line.title} ${line.variantTitle ?? ""}`);
  if (/\b(return|returning|refund|credit|exchange|replacement|custom|laminated|lamination|stair|notch|holed|holes|frosted|bundle|pack|cover|covers|bolt|bolts|inserts)\b/.test(text)) {
    return { product_id: null, method: "review", reason: "SKU conflicts with a return, custom specification, accessory, or pack description" };
  }
  if (inferred.product_id && inferred.product_id !== exact[0].id) {
    return { ...inferred, reason: "Historical SKU conflicts with explicit product specifications; matched using type, dimensions, or finish" };
  }
  const variant = norm(line.variantTitle ?? "");
  const finishText = /\b(black|mb|stainless|brushed|ss)\b/.test(variant) ? variant : text;
  const black = /\b(black|mb)\b/.test(finishText);
  const steel = /\b(stainless|brushed|ss)\b/.test(finishText);
  const suffix = skuKey(exact[0].sku).split("-").at(-1);
  if ((suffix === "SS" && black && !steel) || (suffix === "BL" && steel && !black)) {
    return { product_id: null, method: "review", reason: "SKU and stated finish disagree; insufficient specifications to resolve automatically" };
  }
  return { product_id: exact[0].id, method: "sku", reason: "Same purchasing SKU, including older product listings" };
}
