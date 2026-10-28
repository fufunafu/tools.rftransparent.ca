// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LeadFilterDropdown from "./LeadFilterDropdown";
let root: Root;
let container: HTMLDivElement;
function Harness() {
  const [value, setValue] = useState("all");
  return <><LeadFilterDropdown label="Filter leads by source" allLabel="All sources" value={value} onChange={setValue} options={[{ value: "website", label: "Website" }, { value: "meta", label: "Meta" }, { value: "outreach", label: "Outreach" }]} /><button type="button">Outside</button></>;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("keeps the menu open through the unfocused gap when clicking a checkbox label", async () => {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Filter leads by source"]')!;
  await act(async () => { trigger.focus(); trigger.click(); });
  const label = container.querySelector<HTMLInputElement>('input[value="outreach"]')!.closest("label")!;
  // Browsers can blur the trigger with no relatedTarget before the label forwards
  // its click to the checkbox. The label must not unmount during that gap.
  await act(async () => {
    label.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.blur();
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => label.click());
  expect(container.querySelector<HTMLInputElement>('input[value="outreach"]')!.checked).toBe(false);
  expect(trigger.textContent).toContain("Website, Meta");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(async () => label.click());
  expect(container.querySelector<HTMLInputElement>('input[value="outreach"]')!.checked).toBe(true);
});
it("still dismisses on outside pointer interaction, keyboard focus leaving, and Escape", async () => {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Filter leads by source"]')!;
  const outside = [...container.querySelectorAll("button")].find(button => button.textContent === "Outside")!;
  await act(async () => trigger.click());
  await act(async () => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { trigger.focus(); trigger.click(); });
  await act(async () => outside.focus());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await act(async () => trigger.click());
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});
