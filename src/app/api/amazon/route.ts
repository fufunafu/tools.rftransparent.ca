import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdminUser } from "@/lib/admin-auth";
import { getStores } from "@/lib/shopify";
import { AmazonClient, amazonReadiness } from "@/lib/amazon/client";
import { AmazonError, canSubmit, draftSchema } from "@/lib/amazon/domain";
import { loadCatalog, HARDWARE_STORE_ID, ensureHardwareVariant } from "@/lib/amazon/catalog";
import { signPreview, verifyPreview } from "@/lib/amazon/preview";
import { requireAmazonSecurity } from "@/lib/amazon/security";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
function failure(error: unknown) {
  return error instanceof AmazonError ? json({ error: error.message }, error.status)
    : json({ error: "The service could not be reached. If an upload was in progress, check its Amazon status before retrying." }, 502);
}

const querySchema = z.object({
  action: z.enum(["setup", "catalog", "types", "definition", "status"]).default("setup"),
  storeId: z.string().max(30).optional(), search: z.string().max(250).default(""),
  after: z.string().max(2000).optional(), productType: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
  sku: z.string().min(1).max(40).optional(),
});

export async function GET(request: Request) {
  if (!(await isAdminUser())) return json({ error: "Admin access required" }, 403);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const input = parsed.data;
  try {
    await requireAmazonSecurity();
    if (input.action === "setup") return json({ ...amazonReadiness(), stores: getStores().filter((store) => store.id === HARDWARE_STORE_ID).map(({ id, label }) => ({ id, label })) });
    if (input.action === "catalog") {
      if (!getStores().some((store) => store.id === input.storeId)) return json({ error: "Choose a configured Shopify store" }, 400);
      return json(await loadCatalog(input.storeId!, input.search, input.after));
    }
    const client = new AmazonClient();
    if (input.action === "types") {
      if (!input.search.trim()) return json({ error: "Enter a category search term" }, 400);
      return json(await client.searchTypes(input.search));
    }
    if (input.action === "definition" && input.productType) return json({ schema: await client.definition(input.productType) });
    if (input.action === "status" && input.sku) return json({ listing: await client.listing(input.sku) });
    return json({ error: "Missing product type or SKU" }, 400);
  } catch (error) { return failure(error); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("validate"), draft: draftSchema }).strict(),
  z.object({ action: z.literal("submit"), draft: draftSchema, receipt: z.string().min(1).max(2000) }).strict(),
]);

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AmazonError("JSON required", 415);
  if (!request.body) throw new AmazonError("Request body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 200_000) { await reader.cancel(); throw new AmazonError("Listing is too large", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AmazonError("Invalid JSON"); }
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  if (!(await isAdminUser())) return json({ error: "Admin access required" }, 403);
  const user = await getAuthenticatedUser();
  if (!user) return json({ error: "Sign in again" }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origin not allowed" }, 403);
  try {
    await requireAmazonSecurity();
    const parsed = actionSchema.safeParse(await readBody(request));
    if (!parsed.success) return json({ error: "Choose an Amazon product type, enter a SKU, and complete the listing details." }, 400);
    const input = parsed.data;
    if (input.action === "submit") verifyPreview(input.receipt, input.draft, user.id);
    await ensureHardwareVariant(input.draft.sourceVariantId);
    const client = new AmazonClient();
    await client.ensureNew(input.draft.sku);
    if (input.action === "validate") {
      const result = await client.put(input.draft, true);
      return json({ result, receipt: canSubmit(result) ? signPreview(input.draft, user.id) : null });
    }
    // An unchanged signed preview is required, and server-side validation is
    // repeated because Amazon requirements may change between review and upload.
    const checked = await client.put(input.draft, true);
    if (!canSubmit(checked)) return json({ result: checked, receipt: null, error: "Amazon found issues. Resolve them and validate again." }, 409);
    const result = await client.put(input.draft, false);
    return json({ result });
  } catch (error) { return failure(error); }
}
