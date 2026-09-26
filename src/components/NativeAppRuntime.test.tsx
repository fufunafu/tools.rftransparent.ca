// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://tools.rftransparent.ca/clock"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { isActive?: boolean }) => void>(),
  authenticate: vi.fn(),
  cleanup: vi.fn(),
  fresh: vi.fn(),
  refresh: vi.fn(),
  policy: vi.fn(),
  hidePrivacy: vi.fn(),
}));

vi.mock("next/navigation", () => {
  const router = { refresh: mocks.refresh, push: vi.fn() };
  return { usePathname: () => "/clock", useRouter: () => router };
});
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/lib/app-biometrics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/app-biometrics")>(),
  isNativeApp: () => true,
  authenticateAppSession: mocks.authenticate,
  deviceUnlockAvailable: async () => true,
  clearLegacySavedCredentials: mocks.cleanup,
  consumeFreshNativeSession: mocks.fresh,
}));
vi.mock("@/lib/native-support", () => ({
  getNativeDeviceInfo: async () => null,
  hideNativePrivacyShield: mocks.hidePrivacy,
}));
vi.mock("@/lib/native-links", () => ({ resolveAuthorizedNativeLink: vi.fn() }));
vi.mock("@/lib/native-update", () => ({
  checkNativeUpdate: mocks.policy,
  normalizeNativeUpdateUrl: () => null,
}));
vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: async () => ({ version: "1.0", build: "1" }),
    getLaunchUrl: async () => ({}),
    addListener: async (name: string, callback: (event: { isActive?: boolean }) => void) => {
      mocks.listeners.set(name, callback);
      return { remove: async () => { mocks.listeners.delete(name); } };
    },
  },
}));
vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: async () => ({ connected: true, connectionType: "wifi" }),
    addListener: async () => ({ remove: async () => {} }),
  },
}));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: async () => {} } }));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { setStyle: async () => {} },
  Style: { Light: "LIGHT", Dark: "DARK" },
}));

import NativeAppRuntime from "@/components/NativeAppRuntime";

let root: Root;
let container: HTMLDivElement;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function unlockButton() {
  return container.querySelector<HTMLButtonElement>("[role=dialog] button");
}

function expectLocked() {
  expect(container.querySelector("[role=dialog]")).not.toBeNull();
  expect(container.querySelector("[inert]")).not.toBeNull();
  const logout = container.querySelector<HTMLAnchorElement>('a[href="/api/logout"]');
  expect(logout).not.toBeNull();
  expect(logout?.closest("[inert]")).toBeNull();
}

async function mount() {
  await act(async () => {
    root.render(<NativeAppRuntime><p>Protected work</p></NativeAppRuntime>);
    // Drain native module imports and their startup promises.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(mocks.listeners.has("appStateChange")).toBe(true);
}

async function emit(name: string, event = {}) {
  await act(async () => { mocks.listeners.get(name)?.(event); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.authenticate.mockResolvedValue({ ok: true });
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.fresh.mockReturnValue(false);
  mocks.policy.mockResolvedValue({ state: "current", updateUrl: null });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: "operational" }), { status: 200 })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native unlock recovery", () => {
  it("unlocks after Face ID even if legacy credential cleanup never returns", async () => {
    mocks.cleanup.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });

  it.each(["before-active", "after-active"])("keeps Touch ID unlocked when success arrives %s", async (order) => {
    const authentication = deferred<{ ok: true }>();
    mocks.authenticate.mockReturnValueOnce(authentication.promise)
      .mockReturnValue(new Promise(() => {}));
    await mount();
    expectLocked();
    await emit("appStateChange", { isActive: false });
    if (order === "before-active") {
      await act(async () => { authentication.resolve({ ok: true }); });
      await emit("appStateChange", { isActive: true });
    } else {
      await emit("appStateChange", { isActive: true });
      await act(async () => { authentication.resolve({ ok: true }); });
    }
    expect(container.querySelector("[inert]")).toBeNull();
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.policy).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps cancellation recoverable with manual retry and logout", async () => {
    mocks.authenticate.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    await mount();
    await emit("appStateChange", { isActive: false });
    await emit("appStateChange", { isActive: true });
    expectLocked();
    expect(container.textContent).toContain("Unlock was canceled");
    expect(unlockButton()?.disabled).toBe(false);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    await act(async () => { unlockButton()?.click(); });
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("requires exactly one new unlock after leaving an already unlocked app", async () => {
    await mount();
    expect(container.querySelector("[inert]")).toBeNull();
    const authentication = deferred<{ ok: true }>();
    mocks.authenticate.mockReturnValueOnce(authentication.promise);
    await emit("appStateChange", { isActive: false });
    expect(mocks.listeners.has("pause")).toBe(true);
    await emit("pause");
    expectLocked();
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    await emit("appStateChange", { isActive: true });
    expectLocked();
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    await emit("appStateChange", { isActive: false });
    await act(async () => { authentication.resolve({ ok: true }); });
    await emit("appStateChange", { isActive: true });
    expect(container.querySelector("[inert]")).toBeNull();
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("ignores a late success from before backgrounding and requires a new unlock", async () => {
    const oldAttempt = deferred<{ ok: true }>();
    mocks.authenticate.mockReturnValueOnce(oldAttempt.promise);
    await mount();
    expect(mocks.listeners.has("pause")).toBe(true);
    await emit("pause");
    await act(async () => { oldAttempt.resolve({ ok: true }); });
    expectLocked();
    await emit("appStateChange", { isActive: true });
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("shows retry and logout when the native authentication callback times out", async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, reason: "timed_out" });
    await mount();
    expectLocked();
    expect(container.textContent).toContain("Unlock timed out");
    expect(unlockButton()?.disabled).toBe(false);
  });

  it("aborts a stalled session check and makes recovery controls usable", async () => {
    // Capture the session timeout while retaining real timers for React startup.
    const schedule = window.setTimeout.bind(window);
    let timeout!: () => void;
    vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
      if (delay === 10_000) timeout = callback;
      return schedule(callback, delay);
    }) as typeof window.setTimeout);
    vi.mocked(fetch).mockImplementation(async (url, options) => {
      if (url !== "/api/admin/me") return new Response(JSON.stringify({ state: "operational" }));
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    try {
      await mount();
      expect(unlockButton()?.disabled).toBe(true);
      expectLocked();
      await act(async () => { timeout(); });
      expectLocked();
      expect(unlockButton()?.disabled).toBe(false);
      expect(container.textContent).toContain("could not verify your session");
      expect(mocks.authenticate).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
