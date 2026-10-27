import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  removeAllListeners: vi.fn(),
  addListener: vi.fn(),
  register: vi.fn(),
  recordDiagnostic: vi.fn(),
}));

vi.mock("@/lib/app-biometrics", () => ({ isNativeApp: () => true }));
vi.mock("@/lib/native-diagnostics", () => ({
  recordNativeDiagnosticEvent: mocks.recordDiagnostic,
}));
vi.mock("@/lib/native-support", () => ({
  getNativeDeviceInfo: vi.fn().mockResolvedValue({ pushEnvironment: "sandbox" }),
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    removeAllListeners: mocks.removeAllListeners,
    addListener: mocks.addListener,
    register: mocks.register,
  },
}));

import {
  getPushPreferences,
  registerForPush,
  shouldRegisterPushForPath,
  unregisterForPush,
  updatePushPreferences,
} from "@/lib/app-push";

type Listener = (payload: Record<string, unknown>) => void | Promise<void>;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  const listeners = new Map<string, Listener>();
  const assign = vi.fn();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", {
    location: { origin: "https://tools.rftransparent.ca", assign },
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("/api/native/link?")) {
      const href = new URL(url, "https://tools.rftransparent.ca").searchParams.get("href");
      return new Response(JSON.stringify({ kind: "destination", href }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ registered: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
  mocks.checkPermissions.mockResolvedValue({ receive: "granted" });
  mocks.requestPermissions.mockResolvedValue({ receive: "granted" });
  mocks.removeAllListeners.mockResolvedValue(undefined);
  mocks.addListener.mockImplementation(async (event: string, listener: Listener) => {
    listeners.set(event, listener);
    return { remove: vi.fn() };
  });
  mocks.register.mockResolvedValue(undefined);
  Object.assign(globalThis, { __rfPushListeners: listeners, __rfLocationAssign: assign });
});

function listeners(): Map<string, Listener> {
  return (globalThis as typeof globalThis & { __rfPushListeners: Map<string, Listener> })
    .__rfPushListeners;
}

function locationAssign(): ReturnType<typeof vi.fn> {
  return (globalThis as typeof globalThis & { __rfLocationAssign: ReturnType<typeof vi.fn> })
    .__rfLocationAssign;
}

describe("native push registration and routing", () => {
  it.each(["/login", "/privacy", "/support", "/survey/token", "/wall/token"])(
    "does not request notification access on signed-out path %s",
    (pathname) => {
      expect(shouldRegisterPushForPath(pathname)).toBe(false);
    },
  );

  it("registers only after reaching a signed-in app path", () => {
    expect(shouldRegisterPushForPath("/clock")).toBe(true);
    expect(shouldRegisterPushForPath("/todos")).toBe(true);
  });

  it("registers an APNs token to the signed-in employee", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    expect(mocks.register).toHaveBeenCalledOnce();

    const token = "a".repeat(64);
    listeners().get("registration")?.({ value: token });

    await expect(registration).resolves.toBe("registered");

    expect(localStorage.getItem("rf-push-token")).toBe(token);
    expect(fetch).toHaveBeenCalledWith("/api/push/register", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        token,
        previous_token: null,
        platform: "ios",
        apns_environment: "sandbox",
      }),
    }));
  });

  it("asks the server to disable the previous APNs token during rotation", async () => {
    const previousToken = "7".repeat(64);
    const token = "6".repeat(64);
    localStorage.setItem("rf-push-token", previousToken);

    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    listeners().get("registration")?.({ value: token });

    await expect(registration).resolves.toBe("registered");
    expect(fetch).toHaveBeenCalledWith("/api/push/register", expect.objectContaining({
      body: JSON.stringify({
        token,
        previous_token: previousToken,
        platform: "ios",
        apns_environment: "sandbox",
      }),
    }));
    expect(localStorage.getItem("rf-push-token")).toBe(token);
  });

  it("routes a notification tap to an allowed in-app destination", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    listeners().get("registration")?.({ value: "d".repeat(64) });
    await registration;
    await listeners().get("pushNotificationActionPerformed")?.({
      actionId: "tap",
      notification: { data: { destination: "/todos?filter=today" } },
    });

    expect(locationAssign()).toHaveBeenCalledWith("/todos?filter=today");
    expect(mocks.recordDiagnostic).not.toHaveBeenCalledWith("deep_link_unsupported");
  });

  it("sends an unsupported notification destination to the safe Home fallback", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    listeners().get("registration")?.({ value: "e".repeat(64) });
    await registration;
    await listeners().get("pushNotificationActionPerformed")?.({
      actionId: "RF_OPEN",
      notification: { data: { destination: "https://evil.example/customer" } },
    });

    expect(locationAssign()).toHaveBeenCalledWith("/?native_link=unsupported");
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith("deep_link_unsupported");
  });

  it("does not navigate when a notification is dismissed", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    listeners().get("registration")?.({ value: "9".repeat(64) });
    await registration;
    await listeners().get("pushNotificationActionPerformed")?.({
      actionId: "dismiss",
      notification: { data: { destination: "/todos" } },
    });

    expect(locationAssign()).not.toHaveBeenCalled();
  });

  it("requests notification permission before registering", async () => {
    mocks.checkPermissions.mockResolvedValue({ receive: "prompt" });
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    listeners().get("registration")?.({ value: "f".repeat(64) });
    await expect(registration).resolves.toBe("registered");

    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledOnce();
  });

  it("does not register when notification access is denied", async () => {
    mocks.checkPermissions.mockResolvedValue({ receive: "denied" });

    await expect(registerForPush()).resolves.toBe("denied");

    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("reports a server-side token registration failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("failure", { status: 500 }));
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());

    listeners().get("registration")?.({ value: "1".repeat(64) });

    await expect(registration).resolves.toBe("failed");
    expect(localStorage.getItem("rf-push-token")).toBeNull();
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith("push_registration_failed");
  });

  it("does not retain a token when the signed-in account has no employee profile", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ registered: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());

    listeners().get("registration")?.({ value: "2".repeat(64) });

    await expect(registration).resolves.toBe("unavailable");
    expect(localStorage.getItem("rf-push-token")).toBeNull();
  });

  it("reports an APNs registration error without waiting for a timeout", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());

    listeners().get("registrationError")?.({ error: "unavailable" });

    await expect(registration).resolves.toBe("failed");
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith("push_registration_failed");
  });

  it("loads and updates per-device notification preferences", async () => {
    const token = "b".repeat(64);
    localStorage.setItem("rf-push-token", token);
    const preferences = {
      task_updates: true,
      clock_reminders: false,
      followup_updates: true,
      callback_updates: false,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(preferences), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...preferences, task_updates: false }), { status: 200 }));

    await expect(getPushPreferences()).resolves.toEqual(preferences);
    await expect(updatePushPreferences({ task_updates: false })).resolves.toEqual({
      ...preferences,
      task_updates: false,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/push/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ token, task_updates: false }),
      }),
    );
  });

  it("disables this device token during sign-out", async () => {
    const token = "c".repeat(64);
    localStorage.setItem("rf-push-token", token);

    await unregisterForPush();

    expect(fetch).toHaveBeenCalledWith(
      `/api/push/register?token=${token}`,
      { method: "DELETE", keepalive: true },
    );
    expect(localStorage.getItem("rf-push-token")).toBeNull();
  });

  it("cancels an APNs registration that arrives after sign-out starts", async () => {
    const registration = registerForPush();
    await vi.waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());

    await unregisterForPush();
    await listeners().get("registration")?.({ value: "8".repeat(64) });

    await expect(registration).resolves.toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("rf-push-token")).toBeNull();
  });
});
