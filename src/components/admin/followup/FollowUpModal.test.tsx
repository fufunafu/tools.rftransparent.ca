// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FollowUpModal from "./FollowUpModal";
import type { FollowUpLead } from "@/lib/followup";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const submit = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  submit.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(count: number, store = "store1") {
  const lead = { id: "lead", store_id: store, draft_name: "#Q1", customer_name: "Test Customer", quote_amount: 100, followup_count: count } as FollowUpLead;
  await act(async () => root.render(<FollowUpModal lead={lead} onClose={() => {}} onSubmit={submit} />));
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
}

it("shows three weeks after the first attempt and submits the outcome", async () => {
  await render(0);
  await act(async () => button("No Answer").click());
  expect(container.textContent).toContain("(3 weeks)");
  await act(async () => button("Log Follow-up").click());
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ lead_id: "lead", outcome: "no_answer" }));
});

it("marks the second attempt as final with no next date", async () => {
  await render(1);
  await act(async () => button("No Answer").click());
  expect(container.textContent).toContain("This is the final follow-up.");
  expect(container.textContent).toContain("No further follow-ups after this attempt.");
});

it("only allows a final outcome after the sequence is complete", async () => {
  await render(2);
  expect(button("No Answer").disabled).toBe(true);
  expect(button("Future Project").disabled).toBe(true);
  expect(button("Lost").disabled).toBe(false);
  expect(container.querySelector('[aria-label="Update outcome"]')).not.toBeNull();
});

it("removes custom date overrides for RF while preserving other stores", async () => {
  await render(0);
  await act(async () => button("Future Project").click());
  expect(container.querySelector('input[type="date"]')).toBeNull();
  expect(container.textContent).toContain("(3 weeks)");
  await render(0, "store2");
  expect(container.querySelector('input[type="date"]')).not.toBeNull();
});
