// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import EmployeeDetail from "./EmployeeDetail";

vi.mock("next/dynamic", () => ({ default: () => () => <div>Chart</div> }));
afterEach(() => vi.unstubAllGlobals());

it("shows failed metrics as unavailable and lets quarterly recover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.includes("/history")) return Response.json({ employee: { id: "rob", name: "Rob", department: "sales" }, history: [] });
    if (input.includes("/targets")) return Response.json({ targets: [] });
    if (input.includes("period=quarterly")) return Response.json({ employees: [{ employeeId: "rob", metrics: { current: { sold: 500, conversion_rate: 50 } } }] });
    return Response.json({ error: "Shopify is unavailable" }, { status: 502 });
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EmployeeDetail id="rob" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Shopify is unavailable");
    expect(container.textContent).toContain("Unavailable");
    const quarterly = [...container.querySelectorAll("button")].find((button) => button.textContent === "Quarterly")!;
    await act(async () => quarterly.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("$500");
    expect(quarterly.getAttribute("aria-pressed")).toBe("true");
  } finally { await act(async () => root.unmount()); }
});
