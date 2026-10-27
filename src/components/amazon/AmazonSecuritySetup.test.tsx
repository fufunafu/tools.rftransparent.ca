// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import AmazonSecuritySetup from "./AmazonSecuritySetup";

const mocks = vi.hoisted(() => ({ listFactors: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => ({ auth: { mfa: mocks } }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("keeps access locked until enrollment, code verification, and password certification complete", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let verified = false;
  let certified = false;
  const requests: Record<string, string>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      requests.push(JSON.parse(String(options.body)));
      certified = true;
      return Response.json({ updated: true });
    }
    return Response.json({ mfaVerified: verified, recentMfa: verified, passwordCurrent: certified, passwordExpiresAt: certified ? "2027-10-03T00:00:00Z" : null, ready: verified && certified });
  }));
  mocks.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  const setupKey = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  mocks.enroll.mockResolvedValue({ data: { id: "factor-1", totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>', secret: setupKey, uri: `otpauth://totp/RF%20Tools:test@example.com?secret=${setupKey}&issuer=RF%20Tools&digits=6&period=30` } }, error: null });
  mocks.challengeAndVerify.mockImplementation(async () => { verified = true; return { error: null }; });
  const container = document.createElement("div");
  const root = createRoot(container);
  const click = async (label: string) => act(async () => {
    const button = [...container.querySelectorAll("button")].find((button) => button.textContent === label)!;
    expect(button.disabled).toBe(false);
    if (button.form && button.type === "submit") button.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else button.click();
  });
  const type = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<AmazonSecuritySetup />));
    expect(container.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')!.disabled).toBe(true);
    expect(container.querySelector('a[href="/amazon"]')).toBeNull();
    await click("Set up an authenticator");
    expect(decodeURIComponent(container.querySelector("img")!.src)).toBe('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const appleLink = container.querySelector<HTMLAnchorElement>('a[href^="apple-otpauth:"]')!;
    const appleUrl = new URL(appleLink.href);
    expect(appleUrl.hostname).toBe("totp");
    expect(appleUrl.searchParams.get("issuer")).toBe(window.location.hostname);
    expect(appleUrl.searchParams.get("secret")).toBe(setupKey);
    expect(container.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe(setupKey);
    expect(requests).toHaveLength(0);
    await type(container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!, "123456");
    await click("Verify code");
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="apple-otpauth:"]')).toBeNull();
    expect(container.querySelector('input[readonly]')).toBeNull();
    expect(container.querySelector('a[href="/amazon"]')).toBeNull();
    const inputs = container.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]');
    await type(inputs[0], "Strong Example 42!");
    await type(inputs[1], "Different Example 42!");
    await click("Update password");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("do not match");
    expect(requests).toHaveLength(0);
    await type(inputs[1], "Strong Example 42!");
    await click("Update password");
    expect(requests).toEqual([{ password: "Strong Example 42!" }]);
    expect(inputs[0].value).toBe("");
    expect(inputs[1].value).toBe("");
    expect(container.querySelector('a[href="/amazon"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});
