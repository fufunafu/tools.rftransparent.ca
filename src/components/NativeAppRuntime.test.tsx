// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://tools.rftransparent.ca/clock"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { isActive?: boolean }) => void>(),
  authenticate: vi.fn(),
  cleanup: vi.fn(),
  fresh: vi.fn(),
  refresh: vi.fn(),
  policy: vi.fn(),
  hidePrivacy: vi.fn(),
  label: vi.fn(),
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
  getBiometricLabel: mocks.label,
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

import { getBiometricPreference, setBiometricPreference } from "@/lib/app-biometrics";
import NativeAppRuntime, { useBiometricSettings, useNativeRuntime } from "@/components/NativeAppRuntime";

function SettingsControls() {
  const settings = useBiometricSettings();
  return <><button onClick={settings.configure}>Configure unlock</button><button onClick={settings.disable}>Disable unlock</button><p>{settings.message}</p></>;
}

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
    root.render(<NativeAppRuntime><p>Protected work</p><SettingsControls /></NativeAppRuntime>);
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
  localStorage.clear();
  setBiometricPreference("review@example.com", "enabled");
  mocks.label.mockResolvedValue("Face ID");
  mocks.authenticate.mockResolvedValue({ ok: true });
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.fresh.mockReturnValue(false);
  mocks.policy.mockResolvedValue({ state: "current", updateUrl: null });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ state: "operational", email: "review@example.com" }), { status: 200 })));
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


async function clickText(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

describe("biometric opt-in", () => {
  it.each(["Face ID", "Touch ID"])("asks before calling %s, including immediately after password sign-in", async (label) => {
    localStorage.clear();
    mocks.fresh.mockReturnValueOnce(true);
    mocks.label.mockResolvedValue(label);
    await mount();
    expect(container.textContent).toContain(`Enable ${label}?`);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expectLocked();
    await clickText(`Enable ${label}`);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(getBiometricPreference("review@example.com")).toBe("enabled");
    expect(container.querySelector("[inert]")).toBeNull();
    await emit("pause");
    await emit("appStateChange", { isActive: true });
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
  });

  it("remembers No thanks after backgrounding and a cold launch", async () => {
    localStorage.clear();
    await mount();
    await clickText("No thanks");
    expect(getBiometricPreference("review@example.com")).toBe("disabled");
    expect(container.querySelector("[inert]")).toBeNull();
    await emit("pause");
    await emit("appStateChange", { isActive: true });
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("does not persist consent when authentication is cancelled or fails", async () => {
    localStorage.clear();
    mocks.authenticate.mockResolvedValueOnce({ ok: false, reason: "cancelled" });
    await mount();
    await clickText("Enable Face ID");
    expect(getBiometricPreference("review@example.com")).toBe("unset");
    expect(container.textContent).toContain("Enable Face ID?");
    expectLocked();
    await clickText("No thanks");
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("does not adopt another account's saved choice", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ email: "other@example.com", state: "operational" })));
    await mount();
    expect(container.textContent).toContain("Enable Face ID?");
    expect(mocks.authenticate).not.toHaveBeenCalled();
    await clickText("No thanks");
    expect(getBiometricPreference("review@example.com")).toBe("enabled");
    expect(getBiometricPreference("other@example.com")).toBe("disabled");
  });

  it("keeps ordinary sign-in working when biometrics are unavailable", async () => {
    localStorage.clear();
    mocks.label.mockResolvedValue(null);
    await mount();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(getBiometricPreference("review@example.com")).toBe("unset");
  });

  it("lets a user enable later and turn it off from settings", async () => {
    setBiometricPreference("review@example.com", "disabled");
    await mount();
    await clickText("Configure unlock");
    expect(container.textContent).toContain("Enable Face ID?");
    expect(mocks.authenticate).not.toHaveBeenCalled();
    await clickText("Enable Face ID");
    await clickText("Disable unlock");
    expect(getBiometricPreference("review@example.com")).toBe("disabled");
    await emit("pause");
    await emit("appStateChange", { isActive: true });
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("reports unavailable setup in settings without blocking the signed-in user", async () => {
    setBiometricPreference("review@example.com", "disabled");
    mocks.label.mockResolvedValue(null);
    await mount();
    await clickText("Configure unlock");
    expect(container.textContent).toContain("Set it up or allow access in device Settings");
    expect(container.querySelector("[inert]")).toBeNull();
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("does not enable from a success arriving after backgrounding", async () => {
    localStorage.clear();
    const authentication = deferred<{ ok: true }>();
    mocks.authenticate.mockReturnValueOnce(authentication.promise);
    await mount();
    await clickText("Enable Face ID");
    await emit("pause");
    await act(async () => { authentication.resolve({ ok: true }); });
    expect(getBiometricPreference("review@example.com")).toBe("unset");
    await emit("appStateChange", { isActive: true });
    expect(container.textContent).toContain("Enable Face ID?");
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });
});


describe("opt-in failure recovery", () => {
  it("still verifies the server session when biometric unlock is off", async () => {
    setBiometricPreference("review@example.com", "disabled");
    vi.mocked(fetch).mockImplementation(async (url) => url === "/api/admin/me"
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify({ state: "operational" })));
    await mount();
    expectLocked();
    expect(container.textContent).toContain("could not verify your session");
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.label).not.toHaveBeenCalled();
  });

  it("does not claim a saved opt-in if device storage fails", async () => {
    localStorage.clear();
    await mount();
    const storage = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.getItem(key),
      setItem: () => { throw new Error("full"); },
    });
    try {
      await clickText("Enable Face ID");
      expect(getBiometricPreference("review@example.com")).toBe("unset");
      expect(container.textContent).toContain("Could not save your choice");
      expectLocked();
    } finally {
      vi.stubGlobal("localStorage", storage);
    }
    await clickText("No thanks");
    expect(container.querySelector("[inert]")).toBeNull();
  });

  it("asks the new account again when the account changes while the prompt is open", async () => {
    localStorage.clear();
    await mount();
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ email: "other@example.com", state: "operational" })));
    await clickText("Enable Face ID");
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(getBiometricPreference("review@example.com")).toBe("unset");
    expect(getBiometricPreference("other@example.com")).toBe("unset");
    expect(container.textContent).toContain("Enable Face ID?");
    await clickText("Enable Face ID");
    expect(getBiometricPreference("other@example.com")).toBe("enabled");
  });
});


it("uses a stable server connectivity snapshot when Node exposes navigator without onLine", () => {
  vi.stubGlobal("navigator", {});
  function ConnectionStatus() {
    return <p>{useNativeRuntime().connected ? "Online" : "Offline"}</p>;
  }
  expect(renderToString(<NativeAppRuntime><ConnectionStatus /></NativeAppRuntime>)).toContain("Online");
});
