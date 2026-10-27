// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProductWithMetrics, PurchasingSettings, PurchaseOrderWithRollup } from "@/lib/purchasing/types";

const { push, mutate } = vi.hoisted(() => ({ push: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("swr", () => ({ default: (_key: string, options?: { fallbackData?: unknown }) => ({ data: options?.fallbackData, mutate }) }));
import ReorderTable from "./ReorderTable";
import InventoryTable from "./InventoryTable";
import OrdersList from "./OrdersList";

const settings: PurchasingSettings = { expected_fill: 0.5, lead_time_days: 70, crate_size: 35, season_multipliers: Array(12).fill(1.2), annual_growth_pct: 10, restock_cover_pct: 75 };
const products = [
  { id: "panel", sku: "G40-36", name: "40 inch glass panel", category: "glass", height: 40, suggested_qty: 70, transfer_requirement: 12, sop_label: "reorder_plus_montreal" },
  { id: "spigot", sku: "SP-BL", name: "Black spigot", category: "hardware", height: null, suggested_qty: 25, transfer_requirement: 0, sop_label: "reorder" },
].map((p, index) => ({ current_inventory: 20, inbound: 10, storage_capacity: 100, avg_monthly_sales_rf: 12, avg_monthly_sales_grs: 8, unit_cost_landed: 10, daily_sales: 1, days_of_stock_left: 20, days_of_stock_with_inbound: 30, reorder_point: 80, perfect_qty: 60, inventory_value: 200, sort_order: index, active: true, ...p })) as ProductWithMetrics[];
let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ order: { id: "created" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock); push.mockReset(); mutate.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (component: ReactNode) => act(async () => root.render(component));
const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent?.includes(label))!;
const click = (element: HTMLElement) => act(async () => element.click());
async function input(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("keeps China and Montreal quantities separate and submits only the selected source", async () => {
  await render(<ReorderTable initialProducts={products} initialForecasts={{}} settings={settings} />);
  await click(button("Fill suggested quantities"));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Order quantity for G40-36"]')!.value).toBe("70");
  await click(button("Montreal transfer"));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Order quantity for G40-36"]')!.value).toBe("");
  await click(button("Fill suggested quantities"));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Order quantity for G40-36"]')!.value).toBe("12");
  await click(button("China order"));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Order quantity for G40-36"]')!.value).toBe("70");
  await click(button("Montreal transfer"));
  await click(button("Create draft Montreal transfer"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ order_type: "montreal", notes: null, items: [{ product_id: "panel", qty_ordered: 12 }] });
  expect(push).toHaveBeenCalledWith("/warehouse/purchasing/orders/created");
});

it("applies suggestions only to shown products and exposes selected products hidden by filters", async () => {
  await render(<ReorderTable initialProducts={products} initialForecasts={{}} settings={settings} />);
  await click(button("Glass")); await click(button("Fill suggested quantities"));
  await click(button("Hardware"));
  const summary = container.querySelector('[aria-label="Draft order summary"]')!;
  expect(summary.textContent).toContain("1 hidden by filters");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Order quantity for SP-BL"]')!.value).toBe("");
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove G40-36 from draft"]')!);
  expect((button("Create draft China order") as HTMLButtonElement).disabled).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("blocks negative order quantities instead of silently dropping them from a draft", async () => {
  await render(<ReorderTable initialProducts={products} initialForecasts={{}} settings={settings} />);
  await click(button("Fill suggested quantities"));
  await input(container.querySelector('[aria-label="Order quantity for SP-BL"]')!, "-2");
  expect((button("Create draft China order") as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("zero or more");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a cleared stock input while allowing an explicitly entered zero", async () => {
  await render(<InventoryTable initialProducts={products} initialForecasts={{}} settings={settings} />);
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Edit on-hand count for G40-36: 20"]')!);
  const field = container.querySelector<HTMLInputElement>('[aria-label="On-hand count for G40-36"]')!;
  await input(field, "");
  await act(async () => field.blur());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("previous stock count has been kept");
  await click(container.querySelector<HTMLButtonElement>('[aria-label="Edit on-hand count for G40-36: 20"]')!);
  const zero = container.querySelector<HTMLInputElement>('[aria-label="On-hand count for G40-36"]')!;
  await input(zero, "0");
  await act(async () => zero.blur());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id: "panel", current_inventory: 0 });
});

it("shows products across both categories initially and does not nest column-toggle buttons inside sort buttons", async () => {
  await render(<InventoryTable initialProducts={products} initialForecasts={{}} settings={settings} />);
  expect(container.textContent).toContain("G40-36"); expect(container.textContent).toContain("SP-BL");
  expect(container.querySelector("button button")).toBeNull();
  await click(button("Glass")); expect(container.textContent).not.toContain("SP-BL");
  await click(button("Hardware")); expect(container.textContent).toContain("SP-BL");
});

it("searches purchase orders and calculates filter counts from matching orders", async () => {
  const orders = [
    { id: "one", po_number: "PO-ONE", supplier_name: "Main supplier", order_type: "china", status: "draft", notes: null },
    { id: "two", po_number: "MTL-TWO", supplier_name: "Montreal warehouse", order_type: "montreal", status: "in_transit", notes: "Urgent panels" },
  ].map(o => ({ order_date: "2026-10-27", eta_date: null, line_count: 1, total_qty_ordered: 10, total_qty_received: 0, total_value: 100, percent_received: 0, ...o })) as PurchaseOrderWithRollup[];
  await render(<OrdersList initialOrders={orders} />);
  await input(container.querySelector('[aria-label="Search purchase orders"]')!, "urgent");
  expect(container.querySelector("tbody")!.textContent).toContain("MTL-TWO");
  expect(container.querySelector("tbody")!.textContent).not.toContain("PO-ONE");
  expect(button("Draft").textContent).toBe("Draft (0)");
  expect(button("In transit").textContent).toBe("In transit (1)");
});
