// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SalesRecordsTable } from "./SalesRecordsTable";

afterEach(() => vi.unstubAllGlobals());
it("paginates records and searches numbers or customer names while retaining the full-period total", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const records = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `#RF${index}`, customerName: index === 11 ? "Avery Chen" : null, date: "2026-09-15T12:00:00Z", amount: index === 0 ? -100 : 100, status: "Net payment", url: `https://rf-test.myshopify.com/admin/orders/${index}` }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SalesRecordsTable records={records} total={1000} kind="orders" />));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.textContent).toContain("-$100.00");
    expect(container.textContent).toContain("Name unavailable");
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toContain("Customer");
    expect(container.querySelector("tbody a")?.getAttribute("target")).toBe("_blank");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Next")!.click());
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("#RF11");
    const search = container.querySelector("input")!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(search, "#RF11"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.textContent).toContain("$1,000.00");
    expect(container.textContent).toContain("Matching orders: $100.00");
    expect(container.textContent).toContain("Avery Chen");
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(search, "avery"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.textContent).toContain("#RF11");
    expect(container.textContent).toContain("$1,000.00");
  } finally { await act(async () => root.unmount()); }
});
