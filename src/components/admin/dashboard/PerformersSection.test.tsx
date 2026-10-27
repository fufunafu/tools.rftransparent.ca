// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PerformersSection } from "./PerformersSection";

afterEach(() => vi.unstubAllGlobals());

it("shows all four sales reps, including zero and negative totals, after changing the ranking", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sales = ["Rob", "Daniel", "Craig", "Marie"].map((name, index) => ({
    id: name, name, value: 100 - index * 100, previous: 0,
    metrics: { sold: 100 - index * 100, quoted: index * 100, conversion: 0 }, meta: "0 orders",
  }));
  try {
    await act(async () => root.render(<PerformersSection sections={["sales"]} p={{ sales, warehouse: [], customerService: [], warnings: ["RF performer orders are unavailable"], cachedAt: null }} />));
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/employees/Rob", "/employees/Daniel", "/employees/Craig", "/employees/Marie"]);
    expect(container.textContent).toContain("Net sales $");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("RF performer orders are unavailable");
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "quoted";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/employees/Marie", "/employees/Craig", "/employees/Daniel", "/employees/Rob"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
