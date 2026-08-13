import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface TestForm {
  tagName: string;
  id: string;
  closest: (selector: string) => object | null;
  getAttribute: (name: string) => string | null;
}

type SubmitListener = (event: { target: TestForm }) => void;

const captureScript = readFileSync(
  new URL("../../../docs/shopify-lead-capture.js", import.meta.url),
  "utf8",
);

function captureRuntime() {
  const submitListeners: SubmitListener[] = [];
  const entries: Array<[string, string]> = [
    ["text-5", "Ada"],
    ["text-6", "Lovelace"],
    ["email", "ada@example.com"],
    ["phone-1", "+1 416 555 0100"],
    ["textarea-1", "Frameless deck railing"],
  ];
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ lead_id: "lead-1" }),
  });

  class TestFormData {
    forEach(callback: (value: string, key: string) => void) {
      entries.forEach(([key, value]) => callback(value, key));
    }

    append() {}
  }

  class TestFile {}

  const context = vm.createContext({
    window: { location: { href: "https://glassrailingstore.com/pages/contact" } },
    document: {
      title: "Quotation Request",
      querySelectorAll: () => [],
      addEventListener: (type: string, listener: SubmitListener) => {
        if (type === "submit") submitListeners.push(listener);
      },
    },
    console: { log: vi.fn(), error: vi.fn() },
    setTimeout: vi.fn(),
    FormData: TestFormData,
    File: TestFile,
    fetch: fetchMock,
  });

  return { context, fetchMock, submitListeners };
}

describe("Shopify lead capture storefront script", () => {
  it("supports every drawing format advertised by the live form", () => {
    expect(captureScript).toContain('"image/gif"');
    expect(captureScript).toContain('"image/svg+xml"');
    expect(captureScript).toContain('gif: "image/gif"');
    expect(captureScript).toContain('svg: "image/svg+xml"');
  });

  it("maps the live GRS contact fields and installs only once", async () => {
    const runtime = captureRuntime();
    vm.runInContext(captureScript, runtime.context);
    vm.runInContext(captureScript, runtime.context);

    expect(runtime.submitListeners).toHaveLength(1);

    runtime.submitListeners[0]({
      target: {
        tagName: "FORM",
        id: "",
        closest: () => ({}),
        getAttribute: (name) => (name === "data-id" ? "46323" : null),
      },
    });

    await vi.waitFor(() => expect(runtime.fetchMock).toHaveBeenCalledOnce());
    const [url, request] = runtime.fetchMock.mock.calls[0];
    const payload = JSON.parse(request.body);

    expect(url).toBe("/apps/rf-leads");
    expect(payload.mapped).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+1 416 555 0100",
      message: "Frameless deck railing",
    });
    expect(payload.form_id).toBe("46323");
  });

  it("ignores forms outside Powerful Form Builder", async () => {
    const runtime = captureRuntime();
    vm.runInContext(captureScript, runtime.context);

    runtime.submitListeners[0]({
      target: {
        tagName: "FORM",
        id: "newsletter",
        closest: () => null,
        getAttribute: () => null,
      },
    });

    await Promise.resolve();
    expect(runtime.fetchMock).not.toHaveBeenCalled();
  });
});
