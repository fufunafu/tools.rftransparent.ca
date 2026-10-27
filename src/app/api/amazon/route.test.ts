import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn(), getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/amazon/security", () => ({ requireAmazonSecurity: vi.fn() }));
vi.mock("@/lib/shopify", () => ({ getStores: () => [{ id: "store1", label: "RF" }, { id: "store2", label: "Glass Railing Store" }] }));
vi.mock("@/lib/amazon/catalog", () => ({ HARDWARE_STORE_ID: "store2", ensureHardwareVariant: vi.fn(), loadCatalog: vi.fn() }));
vi.mock("@/lib/amazon/client", async (original) => {
  const actual = await original<typeof import("@/lib/amazon/client")>();
  return { ...actual, AmazonClient: class { ensureNew = mocks.ensureNew; put = mocks.put; } };
});
const mocks = vi.hoisted(() => ({ ensureNew: vi.fn(), put: vi.fn() }));
import { isAdminUser, getAuthenticatedUser } from "@/lib/admin-auth";
import { ensureHardwareVariant } from "@/lib/amazon/catalog";
import { AmazonError, type ListingDraft } from "@/lib/amazon/domain";
import { signPreview } from "@/lib/amazon/preview";
import { GET, POST } from "./route";
import { requireAmazonSecurity } from "@/lib/amazon/security";

const draft: ListingDraft = { sourceVariantId: "gid://shopify/ProductVariant/123", sku: "SP-SS", productType: "HARDWARE", attributes: { item_name: [{ value: "Spigot" }] } };
function request(body: unknown, origin = "https://tools.rftransparent.ca") {
  return new Request("https://tools.rftransparent.ca/api/amazon", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.mocked(isAdminUser).mockResolvedValue(true);
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "owner" } as Awaited<ReturnType<typeof getAuthenticatedUser>>);
  vi.mocked(ensureHardwareVariant).mockResolvedValue();
  mocks.ensureNew.mockResolvedValue(undefined);
  mocks.put.mockImplementation(async (_draft, preview) => ({ sku: "SP-SS", status: preview ? "VALID" : "ACCEPTED", issues: [] }));
  for (const key of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "SELLER_ID"]) vi.stubEnv(`AMAZON_SP_API_${key}`, `test-${key}`);
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it("requires admin access for catalog, configuration, and submission", async () => {
  vi.mocked(isAdminUser).mockResolvedValue(false);
  expect((await GET(new Request("https://tools.rftransparent.ca/api/amazon"))).status).toBe(403);
  expect((await POST(request({ action: "validate", draft }))).status).toBe(403);
  expect(mocks.put).not.toHaveBeenCalled();
});
it("returns only the intended source store and no credentials", async () => {
  const response = await GET(new Request("https://tools.rftransparent.ca/api/amazon"));
  const text = await response.text();
  expect(text).not.toContain("test-CLIENT");
  expect(JSON.parse(text).stores).toEqual([{ id: "store2", label: "Glass Railing Store" }]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("blocks direct API access without the required MFA and password clearance", async () => {
  vi.mocked(requireAmazonSecurity).mockRejectedValue(new AmazonError("Complete security setup", 403));
  expect((await GET(new Request("https://tools.rftransparent.ca/api/amazon?action=catalog&storeId=store2"))).status).toBe(403);
  expect((await POST(request({ action: "validate", draft }))).status).toBe(403);
  expect(mocks.put).not.toHaveBeenCalled();
});
it("rejects cross-origin actions and malformed or oversized input before Amazon calls", async () => {
  expect((await POST(request({ action: "validate", draft }, "https://other.example"))).status).toBe(403);
  expect((await POST(request({ action: "validate", draft: {} }))).status).toBe(400);
  expect((await POST(request({ x: "a".repeat(200001) }))).status).toBe(413);
  expect(mocks.put).not.toHaveBeenCalled();
});
it("prevents glass uploads even when the UI is bypassed", async () => {
  vi.mocked(ensureHardwareVariant).mockRejectedValue(new AmazonError("Only approved hardware"));
  expect((await POST(request({ action: "validate", draft }))).status).toBe(400);
  expect(mocks.put).not.toHaveBeenCalled();
});
it("validation returns a receipt without sending any live upload", async () => {
  const response = await POST(request({ action: "validate", draft }));
  expect(response.status).toBe(200);
  expect((await response.json()).receipt).toBeTruthy();
  expect(mocks.put.mock.calls.map((call) => call[1])).toEqual([true]);
});
it("invalid previews never receive upload permission", async () => {
  mocks.put.mockResolvedValue({ sku: "SP-SS", status: "INVALID", issues: [{ severity: "ERROR", message: "Missing brand", code: "1" }] });
  const response = await POST(request({ action: "validate", draft }));
  expect((await response.json()).receipt).toBeNull();
});
it("blocks submissions without an unchanged signed preview", async () => {
  const receipt = signPreview(draft, "owner");
  expect((await POST(request({ action: "submit", draft: { ...draft, sku: "changed" }, receipt }))).status).toBe(409);
  expect(mocks.put).not.toHaveBeenCalled();
});
it("rechecks existing listings and validation before a live submission", async () => {
  const receipt = signPreview(draft, "owner");
  const response = await POST(request({ action: "submit", draft, receipt }));
  expect(response.status).toBe(200);
  expect((await response.json()).result.status).toBe("ACCEPTED");
  expect(mocks.ensureNew).toHaveBeenCalledWith("SP-SS");
  expect(mocks.put.mock.calls.map((call) => call[1])).toEqual([true, false]);
});
it("never uploads when Amazon finds new validation issues", async () => {
  mocks.put.mockResolvedValue({ sku: "SP-SS", status: "INVALID", issues: [] });
  const response = await POST(request({ action: "submit", draft, receipt: signPreview(draft, "owner") }));
  expect(response.status).toBe(409);
  expect(mocks.put.mock.calls.map((call) => call[1])).toEqual([true]);
});
