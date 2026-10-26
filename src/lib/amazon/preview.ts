import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { amazonConfig } from "./client";
import { AMAZON_US, AmazonError, type ListingDraft } from "./domain";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value);
}
function digest(draft: ListingDraft, actor: string) {
  return createHash("sha256").update(canonical({ draft, actor, marketplace: AMAZON_US, seller: amazonConfig().sellerId })).digest("hex");
}
function signature(payload: string) {
  return createHmac("sha256", amazonConfig().clientSecret).update(`rf-amazon-preview-v1:${payload}`).digest("base64url");
}
export function signPreview(draft: ListingDraft, actor: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ digest: digest(draft, actor), expires: now + 15 * 60_000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function verifyPreview(receipt: string, draft: ListingDraft, actor: string, now = Date.now()) {
  const [payload, supplied, extra] = receipt.split(".");
  if (!payload || !supplied || extra) throw new AmazonError("Validate this listing again before uploading.", 409);
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AmazonError("Validate this listing again before uploading.", 409);
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw new AmazonError("Invalid validation receipt.", 409); }
  if (!Number.isFinite(data.expires) || data.expires <= now || data.digest !== digest(draft, actor)) {
    throw new AmazonError("The listing changed or its validation expired. Validate again before uploading.", 409);
  }
}
