"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { mutate } from "swr";
import {
  authenticateAppSession,
  classifyNativeSessionResponse,
  clearLegacySavedCredentials,
  consumeFreshNativeSession,
  deviceUnlockAvailable,
  isNativeApp,
} from "@/lib/app-biometrics";
import type { NativeRuntimeState } from "@/lib/mobile-types";
import {
  isLocalDevelopmentOrigin,
  isProtectedNativePath,
  isTrustedAppUrl,
  requiresNativeSessionUnlock,
} from "@/lib/native-runtime";
import { resolveAuthorizedNativeLink } from "@/lib/native-links";
import { checkNativeUpdate, normalizeNativeUpdateUrl } from "@/lib/native-update";
import { getNativeDeviceInfo, hideNativePrivacyShield } from "@/lib/native-support";
import { recordNativeDiagnosticEvent } from "@/lib/native-diagnostics";

const RuntimeContext = createContext<NativeRuntimeState>({
  isNative: false,
  connected: true,
  connectionType: "unknown",
  offlineState: "online",
  appVersion: null,
  buildNumber: null,
  environment: "web",
  operatingSystem: null,
  deviceModel: null,
  updateState: "unknown",
  updateUrl: null,
  serviceState: "operational",
});

const NEVER_CHANGES = () => () => {};
const serverIsNotNative = () => false;

export function useNativeRuntime(): NativeRuntimeState {
  return useContext(RuntimeContext);
}

function UnlockOverlay({
  busy,
  error,
  onUnlock,
}: {
  busy: boolean;
  error: string | null;
  onUnlock: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-unlock-title"
      aria-describedby="native-unlock-message"
    >
      <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-xl font-extrabold text-white shadow-lg shadow-blue-600/25">
          RF
        </div>
        <h1 id="native-unlock-title" className="text-2xl font-bold tracking-tight text-slate-950">
          RF Tools is locked
        </h1>
        <p id="native-unlock-message" className="mt-2 text-sm leading-6 text-slate-500">
          Use Face ID, Touch ID, or your device passcode to continue.
        </p>
        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button
          autoFocus
          type="button"
          disabled={busy}
          onClick={onUnlock}
          className="mt-6 min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white shadow-lg shadow-blue-600/20 transition active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? "Unlocking..." : "Unlock RF Tools"}
        </button>
        <a
          href="/api/logout"
          className="mt-3 flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-slate-500"
        >
          Sign out instead
        </a>
      </div>
    </div>
  );
}

export default function NativeAppRuntime({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Keep the server snapshot deterministic. Reading Capacitor directly during
  // hydration would render web diagnostics on the server and native
  // diagnostics on the first client pass.
  const native = useSyncExternalStore(NEVER_CHANGES, isNativeApp, serverIsNotNative);
  const [connected, setConnected] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [connectionType, setConnectionType] = useState<NativeRuntimeState["connectionType"]>("unknown");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [buildNumber, setBuildNumber] = useState<string | null>(null);
  const [operatingSystem, setOperatingSystem] = useState<string | null>(null);
  const [deviceModel, setDeviceModel] = useState<string | null>(null);
  const [nativeCrashCount, setNativeCrashCount] = useState(0);
  const [lastNativeCrashAt, setLastNativeCrashAt] = useState<string | null>(null);
  const [lastNativeCrashSignature, setLastNativeCrashSignature] = useState<string | null>(null);
  const [webViewLoadFailureCount, setWebViewLoadFailureCount] = useState(0);
  const [lastWebViewLoadFailureAt, setLastWebViewLoadFailureAt] = useState<string | null>(null);
  const [lastLifecycleError, setLastLifecycleError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<NativeRuntimeState["updateState"]>("unknown");
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [updateCheckPending, setUpdateCheckPending] = useState(true);
  const [recommendedUpdateDismissed, setRecommendedUpdateDismissed] = useState(false);
  const [serviceState, setServiceState] = useState<NativeRuntimeState["serviceState"]>("operational");
  const [serviceMessage, setServiceMessage] = useState<string | null>(null);
  const [appIsActive, setAppIsActive] = useState(true);
  const [locked, setLocked] = useState(false);
  const [sessionUnlocked, setSessionUnlocked] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const authenticating = useRef(false);
  const backgrounded = useRef(false);
  const readyRecorded = useRef(false);
  const policyRequest = useRef(0);

  const localPreview = useCallback(
    () => typeof window !== "undefined" && isLocalDevelopmentOrigin(window.location.origin),
    [],
  );

  const hideSplash = useCallback(async () => {
    if (!native) return;
    document.documentElement.dataset.rfAppReady = "true";
    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide({ fadeOutDuration: 180 });
      if (!readyRecorded.current) {
        readyRecorded.current = true;
        recordNativeDiagnosticEvent("webview_ready");
      }
    } catch {
      // The web build has no native splash screen.
    }
  }, [native]);

  const routeNativeUrl = useCallback(async (value: string) => {
    const result = await resolveAuthorizedNativeLink(value, window.location.origin);
    if (result.kind === "unsupported") {
      recordNativeDiagnosticEvent("deep_link_unsupported");
    } else if (result.kind === "expired") {
      recordNativeDiagnosticEvent("deep_link_expired");
    } else if (result.kind === "unauthorized") {
      recordNativeDiagnosticEvent("deep_link_unauthorized");
    }
    if (result.kind === "unauthenticated") {
      window.location.replace(result.href);
      return;
    }
    router.push(result.href);
  }, [router]);

  const refreshNativePolicy = useCallback(async (build: string) => {
    const request = ++policyRequest.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    setUpdateCheckPending(true);
    const [updateResult, serviceResult] = await Promise.allSettled([
      checkNativeUpdate(build, controller.signal),
      fetch("/api/native/status", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("status unavailable");
          return response.json() as Promise<{ state?: string; message?: string | null }>;
        }),
    ]);
    window.clearTimeout(timeout);
    if (request !== policyRequest.current) return;

    if (updateResult.status === "fulfilled") {
      setUpdateState(updateResult.value.state);
      setUpdateUrl(updateResult.value.updateUrl);
    } else {
      setUpdateState("unknown");
      setUpdateUrl(null);
      recordNativeDiagnosticEvent("version_check_failed");
    }

    if (serviceResult.status === "fulfilled" && serviceResult.value.state === "maintenance") {
      setServiceState("maintenance");
      setServiceMessage(serviceResult.value.message ?? "RF Tools is temporarily unavailable for maintenance.");
    } else if (serviceResult.status === "fulfilled" && serviceResult.value.state === "operational") {
      setServiceState("operational");
      setServiceMessage(null);
    } else {
      setServiceState(navigator.onLine ? "unavailable" : "operational");
      setServiceMessage(null);
      recordNativeDiagnosticEvent("maintenance_check_failed");
    }
    setUpdateCheckPending(false);
  }, []);

  const retryNativeConnection = useCallback(async () => {
    try {
      const { Network } = await import("@capacitor/network");
      const status = await Network.getStatus();
      setConnected(status.connected);
      setConnectionType(status.connectionType);
      if (!status.connected) return;
      router.refresh();
      await mutate(() => true);
      if (buildNumber) await refreshNativePolicy(buildNumber);
    } catch {
      recordNativeDiagnosticEvent("plugin_failed");
      setConnected(navigator.onLine);
      if (navigator.onLine) router.refresh();
    }
  }, [buildNumber, refreshNativePolicy, router]);

  const unlock = useCallback(async () => {
    if (!native || authenticating.current) return;
    if (localPreview()) {
      setSessionUnlocked(true);
      setLocked(false);
      setUnlockError(null);
      await hideSplash();
      return;
    }
    authenticating.current = true;
    setLocked(true);
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const session = await fetch("/api/admin/me", { cache: "no-store" });
      const sessionDecision = classifyNativeSessionResponse(session);
      if (sessionDecision === "expired") {
        window.location.replace("/login?error=session_expired");
        return;
      }
      if (sessionDecision === "unavailable") {
        recordNativeDiagnosticEvent("session_check_failed");
        setLocked(true);
        setUnlockError("RF Tools could not verify your session. Check your connection and try again.");
        return;
      }

      if (!(await deviceUnlockAvailable())) {
        recordNativeDiagnosticEvent("device_unlock_failed");
        await hideSplash();
        setUnlockError(
          "Device authentication is unavailable. Set up Face ID, Touch ID, or a device passcode, then try again.",
        );
        return;
      }

      await hideSplash();
      const result = await authenticateAppSession();
      if (result.ok) {
        await clearLegacySavedCredentials();
        setSessionUnlocked(true);
        setLocked(false);
        setUnlockError(null);
        return;
      }
      setLocked(true);
      recordNativeDiagnosticEvent("device_unlock_failed");
      if (result.reason === "locked") {
        setUnlockError("Device authentication is temporarily locked. Use your device passcode or try again later.");
      } else if (result.reason === "cancelled") {
        setUnlockError("Unlock was canceled. Authenticate when you are ready to continue.");
      } else if (result.reason === "unavailable") {
        setUnlockError("Device authentication is unavailable. Check your device security settings and try again.");
      } else if (result.reason === "failed") {
        setUnlockError("RF Tools could not verify your identity. Try again.");
      }
    } catch {
      setLocked(true);
      recordNativeDiagnosticEvent("session_check_failed");
      setUnlockError("RF Tools is offline. Reconnect before unlocking.");
    } finally {
      authenticating.current = false;
      setUnlockBusy(false);
      await hideSplash();
    }
  }, [hideSplash, localPreview, native]);

  useEffect(() => {
    if (!native) return;
    recordNativeDiagnosticEvent("cold_start");
    document.documentElement.dataset.nativeApp = "true";
    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
      const [{ App }, { Network }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/network"),
      ]);
      const [info, network, device] = await Promise.all([
        App.getInfo(),
        Network.getStatus(),
        getNativeDeviceInfo(),
      ]);
      if (cancelled) return;
      setAppVersion(info.version);
      setBuildNumber(info.build);
      setConnected(network.connected);
      setConnectionType(network.connectionType);
      setOperatingSystem(device?.operatingSystem ?? null);
      setDeviceModel(device?.deviceModel ?? null);
      setNativeCrashCount(device?.nativeCrashCount ?? 0);
      setLastNativeCrashAt(device?.lastNativeCrashAt ?? null);
      setLastNativeCrashSignature(device?.lastNativeCrashSignature ?? null);
      setWebViewLoadFailureCount(device?.webViewLoadFailureCount ?? 0);
      setLastWebViewLoadFailureAt(device?.lastWebViewLoadFailureAt ?? null);
      setLastLifecycleError(device?.lastLifecycleError ?? null);
      void refreshNativePolicy(info.build);

      const launch = await App.getLaunchUrl();
      if (launch?.url) void routeNativeUrl(launch.url);

      handles.push(
        await Network.addListener("networkStatusChange", (status) => {
          setConnected(status.connected);
          setConnectionType(status.connectionType);
          document.documentElement.dataset.network = status.connected ? "online" : "offline";
          if (status.connected) {
            router.refresh();
            void mutate(() => true);
          }
        }),
      );
      handles.push(
        await App.addListener("appUrlOpen", ({ url }) => void routeNativeUrl(url)),
      );
      handles.push(
        await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            setAppIsActive(false);
            backgrounded.current = true;
            setSessionUnlocked(false);
            if (
              !localPreview() &&
              !authenticating.current &&
              isProtectedNativePath(window.location.pathname)
            ) {
              setLocked(true);
            }
            return;
          }
          setAppIsActive(true);
          router.refresh();
          void mutate(() => true);
          window.dispatchEvent(new Event("rf:app-resume"));
          void refreshNativePolicy(info.build);
          const shouldUnlock =
            !localPreview() &&
            backgrounded.current &&
            isProtectedNativePath(window.location.pathname);
          backgrounded.current = false;
          if (shouldUnlock) {
            void unlock();
          }
          window.requestAnimationFrame(() => void hideNativePrivacyShield());
        }),
      );
    })().catch(() => {
      setConnected(navigator.onLine);
      setUpdateCheckPending(false);
      recordNativeDiagnosticEvent("plugin_failed");
    });

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.nativeApp;
      delete document.documentElement.dataset.rfAppReady;
      for (const handle of handles) void handle.remove();
    };
  }, [localPreview, native, refreshNativePolicy, routeNativeUrl, router, unlock]);

  useEffect(() => {
    document.documentElement.dataset.network = connected ? "online" : "offline";
  }, [connected]);

  useEffect(() => {
    if (!native) return;
    const onError = () => recordNativeDiagnosticEvent("javascript_error");
    const onUnhandledRejection = () => recordNativeDiagnosticEvent("unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [native]);

  useEffect(() => {
    const updateBrowserConnection = () => setConnected(navigator.onLine);
    window.addEventListener("online", updateBrowserConnection);
    window.addEventListener("offline", updateBrowserConnection);
    return () => {
      window.removeEventListener("online", updateBrowserConnection);
      window.removeEventListener("offline", updateBrowserConnection);
    };
  }, []);

  useEffect(() => {
    if (!native) return;
    void (async () => {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      await StatusBar.setStyle({ style: locked ? Style.Light : Style.Dark });
    })().catch(() => {
      recordNativeDiagnosticEvent("plugin_failed");
      // Status-bar appearance is cosmetic and must not interrupt app unlock.
    });
  }, [locked, native, pathname]);

  useEffect(() => {
    if (!native) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(url.protocol) || isTrustedAppUrl(url, window.location.origin)) return;
      // Let the native navigation guard hand approved update destinations to
      // iOS directly so App Store and TestFlight links open in their apps.
      if (normalizeNativeUpdateUrl(url.toString())) return;
      event.preventDefault();
      void import("@capacitor/browser").then(({ Browser }) =>
        Browser.open({ url: url.toString(), presentationStyle: "popover", toolbarColor: "#1e3a8a" }),
      );
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [native]);

  useEffect(() => {
    if (!native) return;
    // Clearing the in-memory unlock on background is intentional, but that
    // state change must not launch the system authentication prompt while the
    // app is inactive. The foreground callback below performs the retry once
    // iOS has made the app active again.
    if (!appIsActive) return;
    if (localPreview()) {
      setSessionUnlocked(true);
      setLocked(false);
      void hideSplash();
      return;
    }
    if (!isProtectedNativePath(pathname)) {
      setLocked(false);
      void hideSplash();
      return;
    }
    if (sessionUnlocked) {
      setLocked(false);
      void hideSplash();
      return;
    }
    if (consumeFreshNativeSession()) {
      setSessionUnlocked(true);
      setLocked(false);
      void clearLegacySavedCredentials();
      void hideSplash();
      return;
    }
    void unlock();
  }, [appIsActive, hideSplash, localPreview, native, pathname, sessionUnlocked, unlock]);

  const pathNeedsUnlock =
    native && !localPreview() && requiresNativeSessionUnlock(pathname, sessionUnlocked);
  const effectivelyLocked = pathNeedsUnlock || (native && isProtectedNativePath(pathname) && locked);
  const updateRequired = native && updateState === "required";
  const maintenanceRequired = native && connected && serviceState === "maintenance" && !updateRequired;
  const offlineRequired = native && !connected && !updateRequired;
  const policyCheckRequired = native && connected && updateCheckPending && !updateRequired && !maintenanceRequired;
  const unlockRequired = effectivelyLocked && !updateRequired && !maintenanceRequired && !offlineRequired && !policyCheckRequired;
  const contentBlocked = updateRequired || maintenanceRequired || offlineRequired || policyCheckRequired || unlockRequired;

  const value = useMemo<NativeRuntimeState>(
    () => ({
      isNative: native,
      connected,
      connectionType,
      offlineState: connected ? "online" : "offline",
      appVersion,
      buildNumber,
      environment: native
        ? window.location.hostname === "tools.rftransparent.ca"
          ? "production"
          : "development"
        : "web",
      operatingSystem,
      deviceModel,
      nativeCrashCount,
      lastNativeCrashAt,
      lastNativeCrashSignature,
      webViewLoadFailureCount,
      lastWebViewLoadFailureAt,
      lastLifecycleError,
      updateState,
      updateUrl,
      serviceState,
    }),
    [appVersion, buildNumber, connected, connectionType, deviceModel, lastLifecycleError, lastNativeCrashAt, lastNativeCrashSignature, lastWebViewLoadFailureAt, native, nativeCrashCount, operatingSystem, serviceState, updateState, updateUrl, webViewLoadFailureCount],
  );

  return (
    <RuntimeContext.Provider value={value}>
      <div
        className="contents"
        inert={contentBlocked ? true : undefined}
        aria-hidden={contentBlocked ? true : undefined}
      >
        {children}
        {native && connected && serviceState === "unavailable" && (
          <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-[80] mx-auto max-w-sm rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-xl" role="alert">
            <p className="text-center text-xs font-bold">RF Tools could not confirm service status. Avoid submitting work until the connection recovers.</p>
            <button type="button" onClick={() => buildNumber && void refreshNativePolicy(buildNumber)} className="mt-2 min-h-11 w-full rounded-xl bg-white px-3 text-xs font-bold text-slate-900">Try again</button>
          </div>
        )}
        {native && updateState === "recommended" && updateUrl && !recommendedUpdateDismissed && (
          <div className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+12px)] z-[85] mx-auto max-w-sm rounded-2xl border border-blue-200 bg-white p-4 shadow-xl" role="status">
            <p className="text-sm font-bold text-slate-950">A newer RF Tools build is available.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRecommendedUpdateDismissed(true)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700">Later</button>
              <a href={updateUrl} className="flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-3 text-xs font-bold text-white">Update</a>
            </div>
          </div>
        )}
      </div>
      {maintenanceRequired && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" role="alertdialog" aria-modal="true" aria-labelledby="native-maintenance-title" aria-describedby="native-maintenance-message">
          <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-xl font-extrabold text-white">RF</div>
            <h1 id="native-maintenance-title" className="text-2xl font-bold tracking-tight text-slate-950">Maintenance in progress</h1>
            <p id="native-maintenance-message" className="mt-3 text-sm leading-6 text-slate-600">{serviceMessage}</p>
            <p className="mt-3 text-sm font-semibold text-amber-800">No work is submitted while this screen is shown.</p>
            <button autoFocus type="button" onClick={() => buildNumber && void refreshNativePolicy(buildNumber)} className="mt-6 min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white">Try again</button>
            <a href="mailto:info@glass-railing.com?subject=RF%20Tools%20maintenance" className="mt-2 flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-slate-600">Contact support</a>
          </div>
        </div>
      )}
      {offlineRequired && (
        <div className="fixed inset-0 z-[115] flex items-start justify-center overflow-y-auto bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" role="alertdialog" aria-modal="true" aria-labelledby="native-offline-title" aria-describedby="native-offline-message">
          <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-600 text-xl font-extrabold text-white">RF</div>
            <h1 id="native-offline-title" className="text-2xl font-bold tracking-tight text-slate-950">You are offline</h1>
            <p id="native-offline-message" className="mt-3 text-sm leading-6 text-slate-600">Reconnect to Wi-Fi or cellular data before continuing. Actions are blocked while the app is offline.</p>
            <p className="mt-3 text-sm font-semibold text-amber-800">Your work has not been submitted.</p>
            <p className="mt-3 text-xs text-slate-500">Version {appVersion ?? "unknown"} · build {buildNumber ?? "unknown"}</p>
            <button autoFocus type="button" onClick={() => void retryNativeConnection()} className="mt-6 min-h-12 w-full rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white">Try again</button>
            <a href="mailto:info@glass-railing.com?subject=RF%20Tools%20connection%20help" className="mt-2 flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-slate-600">Contact support</a>
          </div>
        </div>
      )}
      {policyCheckRequired && (
        <div className="fixed inset-0 z-[118] flex items-start justify-center overflow-y-auto bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" role="status" aria-live="polite">
          <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-xl font-extrabold text-white">RF</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Checking RF Tools</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">Confirming this app build is compatible and the service is available.</p>
          </div>
        </div>
      )}
      {updateRequired && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" role="alertdialog" aria-modal="true" aria-labelledby="native-update-title" aria-describedby="native-update-message">
          <div className="my-auto w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
            <h1 id="native-update-title" className="text-2xl font-bold tracking-tight text-slate-950">RF Tools needs an update</h1>
            <p id="native-update-message" className="mt-3 text-sm leading-6 text-slate-600">This build is no longer compatible with the service. Update before continuing.</p>
            {updateUrl ? (
              <a autoFocus href={updateUrl} className="mt-6 flex min-h-12 items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white">Update RF Tools</a>
            ) : (
              <>
                <p className="mt-3 text-sm font-semibold text-amber-800">The update link is temporarily unavailable. Contact support before doing more work.</p>
                <a autoFocus href="mailto:info@glass-railing.com?subject=RF%20Tools%20required%20update" className="mt-6 flex min-h-12 items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-base font-bold text-white">Contact support</a>
              </>
            )}
          </div>
        </div>
      )}
      {unlockRequired && <UnlockOverlay busy={unlockBusy} error={unlockError} onUnlock={() => void unlock()} />}
    </RuntimeContext.Provider>
  );
}
