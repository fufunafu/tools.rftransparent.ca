// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RecordForm from "./RecordForm";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("keeps a typed draft when Escape is pressed and closes an untouched form", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<RecordForm type="notes" related={null} onClose={onClose} onSaved={vi.fn()} />));
  const dialog = container.querySelector("dialog")!;
  const cancel = () => { const event = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(event); return event; };
  await act(async () => { cancel(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  const title = container.querySelector('input[name="title"]') as HTMLInputElement;
  await act(async () => { title.value = "Call notes"; title.dispatchEvent(new Event("input", { bubbles: true })); });
  let event!: Event;
  await act(async () => { event = cancel(); });
  expect(event.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Use Close to discard it");
});
