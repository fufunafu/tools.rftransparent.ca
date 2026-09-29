// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SalesTeamTable } from "./SalesTeamTable";
import { SALES_PERIODS } from "@/lib/sales-periods";
import type { SalesTeamOverview } from "@/lib/ops-dashboard";

vi.mock("./SalesRecordsDialog", () => ({ SalesRecordsDialog: ({ selection }: { selection: { repName: string; period: string; kind: string } }) => <div role="dialog">{selection.repName} {selection.period} {selection.kind}</div> }));
afterEach(() => vi.unstubAllGlobals());

it("shows all date ranges and five reps together, with per-column totals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const periods: SalesTeamOverview["periods"] = { "7d": [], "30d": [], "90d": [], "180d": [], "1y": [] };
  for (const period of SALES_PERIODS) {
    periods[period.id] = ["Rob", "Daniel", "Craig", "Marie", "Aaron"].map((name, index) => ({
      id: name, name, hasEmployeeProfile: name !== "Aaron", value: index === 3 ? 0 : period.days, previous: 1,
      attributionExplanation: `${name} attribution rules`,
      metrics: { sold: index === 3 ? 0 : period.days, quoted: 10, conversion: 50 }, meta: "1 order",
    }));
  }
  try {
    await act(async () => root.render(<SalesTeamTable data={{ periods, warnings: [], cachedAt: null }} />));
    expect([...container.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Sales rep", "Metric", ...SALES_PERIODS.map((period) => period.label.replace("Last ", ""))]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.querySelectorAll("tbody td")).toHaveLength(50);
    expect([...container.querySelectorAll("tfoot td")].map((cell) => cell.textContent)).toEqual(["$28", "$120", "$360", "$720", "$1.5k", "$50", "$50", "$50", "$50", "$50"]);
    expect(container.querySelectorAll("tbody th[scope=\"row\"]")).toHaveLength(10);
    expect(container.querySelector("tbody tr:nth-child(2) td")?.textContent).toBe("$10");
    expect(container.querySelector('[aria-label="Sales date range"]')).toBeNull();
    expect([...container.querySelectorAll("tbody a")].some((link) => link.textContent?.includes("Aaron"))).toBe(false);
    expect(container.textContent).toContain("Aaron");
    const aaronInfo = container.querySelector<HTMLButtonElement>(`button[aria-label="How Aaron's totals are calculated"]`)!;
    await act(async () => aaronInfo.click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Aaron attribution rules");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Tax and shipping are removed proportionally");
    expect(aaronInfo.getAttribute("aria-describedby")).toBe(document.querySelector('[role="tooltip"]')?.id);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "conversion"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll("thead th")).toHaveLength(7);
    expect(container.querySelector("tfoot")).not.toBeNull();
    expect(container.querySelectorAll("tbody th[scope=\"row\"]")).toHaveLength(10);
    expect(container.querySelector("tbody tr:nth-child(2) td")?.textContent).toBe("$10");
    expect(container.textContent).not.toContain("50.0% converted");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Show details")!.click());
    expect(container.textContent).toContain("50.0% converted");
    const quotesButton = container.querySelector<HTMLButtonElement>('button[aria-label="View Aaron quotes for last 7 days"]')!;
    await act(async () => quotesButton.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Aaron 7d quotes");
  } finally { await act(async () => root.unmount()); }
});
