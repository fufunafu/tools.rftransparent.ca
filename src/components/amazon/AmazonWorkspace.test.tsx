// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AmazonWorkspace from "./AmazonWorkspace";

let container: HTMLDivElement;
let root: Root;
const source = { id: "gid://shopify/ProductVariant/123", sku: "SP-SS", title: "Spigot", brand: "Brand", barcode: "123456789012", description: "Hardware", image: "", price: "75", currency: "USD", inventory: 500 };
const schema = { type: "object", properties: { item_name: { title: "Title", type: "array", items: { type: "object", properties: { value: { type: "string" }, marketplace_id: { type: "string" }, language_tag: { type: "string" } } } } } };
function button(text: string) {
  const result = [...container.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function prepareDraft() {
  await act(async () => { root.render(<AmazonWorkspace />); });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await click("Add");
  await click("Search categories");
  await act(async () => {
    const select = [...container.querySelectorAll("select")].find((node) => node.textContent?.includes("Choose a category"))!;
    select.value = "HARDWARE"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.body) {
      const body = JSON.parse(options.body as string);
      return Response.json({ result: { sku: "SP-SS", status: body.action === "validate" ? "VALID" : "ACCEPTED", issues: [] }, receipt: body.action === "validate" ? "receipt" : undefined });
    }
    const action = new URL(url, "http://localhost").searchParams.get("action");
    if (action === "setup") return Response.json({ configured: true, missing: [], stores: [{ id: "store2", label: "Glass Railing Store" }] });
    if (action === "catalog") return Response.json({ items: [source], hasNextPage: false, endCursor: null });
    if (action === "types") return Response.json({ productTypes: [{ name: "HARDWARE", displayName: "Hardware" }] });
    if (action === "definition") return Response.json({ schema });
    return Response.json({ listing: { summaries: [{ asin: "B123456789", status: ["BUYABLE"] }], issues: [] } });
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("requires validation and a concrete review before upload, then shows received rather than live", async () => {
  await prepareDraft();
  expect(button("Review upload (0)").disabled).toBe(true);
  await click("Validate drafts with Amazon");
  expect(button("Review upload (1)").disabled).toBe(false);
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.body && JSON.parse(options.body as string).action === "submit")).toHaveLength(0);
  await click("Review upload (1)");
  expect(container.textContent).toContain("Upload 1 listing to Amazon US?");
  await click("Upload these listings");
  expect(container.textContent).toContain("Amazon response: ACCEPTED");
  expect(container.textContent).not.toContain("BUYABLE");
  await click("Check Amazon status");
  expect(container.textContent).toContain("B123456789: BUYABLE");
});
it("invalidates a preview when listing attributes change", async () => {
  await prepareDraft(); await click("Validate drafts with Amazon");
  await click("Remove field");
  expect(button("Review upload (0)").disabled).toBe(true);
});
it("allows catalog preparation while Amazon setup is incomplete", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ configured: false, missing: ["AMAZON_SP_API_CLIENT_ID"], stores: [{ id: "store2", label: "Glass Railing Store" }] }));
  await act(async () => { root.render(<AmazonWorkspace />); });
  expect(container.textContent).toContain("Connect your Amazon seller account");
  expect(button("Find products").disabled).toBe(false);
  expect(container.textContent).toContain("Glass panels, custom glass, and mixed sample kits are excluded");
});

it("blocks duplicate SKUs in a batch before asking Amazon to validate", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("action=catalog")) return Response.json({ items: [source, { ...source, id: "gid://shopify/ProductVariant/456" }], hasNextPage: false, endCursor: null });
    return original(url, options);
  });
  await prepareDraft();
  await click("Add");
  await click("Validate drafts with Amazon");
  expect(container.textContent).toContain("Each variant needs a unique Amazon SKU");
  expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.body)).toHaveLength(0);
});
