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
} from "@/lib/native-runtime";

const RuntimeContext = createContext<NativeRuntimeState>({
  isNative: false,
  connected: true,
  connectionType: "unknown",
  offlineState: "online",
  appVersion: null,
  buildNumber: null,
  environment: "web",
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-blue-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="native-unlock-title"
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-xl font-extrabold text-white shadow-lg shadow-blue-600/25">
          RF
        </div>
        <h1 id="native-unlock-title" className="text-2xl font-bold tracking-tight text-slate-950">
          RF Tools is locked
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Use Face ID, Touch ID, or your device passcode to continue.
        </p>
        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button
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
  const [locked, setLocked] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const authenticating = useRef(false);
  const backgrounded = useRef(false);
  const initialProtectionChecked = useRef(false);

  const localPreview = useCallback(
    () => typeof window !== "undefined" && isLocalDevelopmentOrigin(window.location.origin),
    [],
  );

  const hideSplash = useCallback(async () => {
    if (!native) return;
    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide({ fadeOutDuration: 180 });
    } catch {
      // The web build has no native splash screen.
    }
  }, [native]);

  const unlock = useCallback(async () => {
    if (!native || authenticating.current) return;
    if (localPreview()) {
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
      if (session.status === 401 || session.status === 403) {
        window.location.replace("/login?error=session_expired");
        return;
      }
      if (!session.ok) {
        setLocked(true);
        setUnlockError("RF Tools could not verify your session. Check your connection and try again.");
        return;
      }

      if (!(await deviceUnlockAvailable())) {
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
        setLocked(false);
        setUnlockError(null);
        return;
      }
      setLocked(true);
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
      setUnlockError("RF Tools is offline. Reconnect before unlocking.");
    } finally {
      authenticating.current = false;
      setUnlockBusy(false);
      await hideSplash();
    }
  }, [hideSplash, localPreview, native]);

  useEffect(() => {
    if (!native) return;
    document.documentElement.dataset.nativeApp = "true";
    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
      const [{ App }, { Network }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/network"),
      ]);
      const [info, network] = await Promise.all([App.getInfo(), Network.getStatus()]);
      if (cancelled) return;
      setAppVersion(info.version);
      setBuildNumber(info.build);
      setConnected(network.connected);
      setConnectionType(network.connectionType);

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
        await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) {
            if (
              !localPreview() &&
              !authenticating.current &&
              isProtectedNativePath(window.location.pathname)
            ) {
              backgrounded.current = true;
              setLocked(true);
            }
            return;
          }
          router.refresh();
          void mutate(() => true);
          window.dispatchEvent(new Event("rf:app-resume"));
          if (
            !localPreview() &&
            backgrounded.current &&
            isProtectedNativePath(window.location.pathname)
          ) {
            backgrounded.current = false;
            void unlock();
          }
        }),
      );
    })().catch(() => {
      setConnected(navigator.onLine);
    });

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.nativeApp;
      for (const handle of handles) void handle.remove();
    };
  }, [localPreview, native, router, unlock]);

  useEffect(() => {
    document.documentElement.dataset.network = connected ? "online" : "offline";
  }, [connected]);

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
      event.preventDefault();
      void import("@capacitor/browser").then(({ Browser }) =>
        Browser.open({ url: url.toString(), presentationStyle: "popover", toolbarColor: "#1e3a8a" }),
      );
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [native]);

  useEffect(() => {
    if (!native || initialProtectionChecked.current) return;
    initialProtectionChecked.current = true;
    if (localPreview()) {
      setLocked(false);
      void hideSplash();
      return;
    }
    if (!isProtectedNativePath(pathname)) {
      setLocked(false);
      void hideSplash();
      return;
    }
    if (consumeFreshNativeSession()) {
      setLocked(false);
      void clearLegacySavedCredentials();
      void hideSplash();
      return;
    }
    void unlock();
  }, [hideSplash, localPreview, native, pathname, unlock]);

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
    }),
    [appVersion, buildNumber, connected, connectionType, native],
  );

  return (
    <RuntimeContext.Provider value={value}>
      {children}
      {native && !connected && (
        <div
          className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-[80] mx-auto max-w-sm rounded-2xl bg-amber-950 px-4 py-3 text-white shadow-xl"
          role="alert"
        >
          <p className="text-center text-xs font-bold">Offline. Actions are disabled until you reconnect.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => router.refresh()} className="min-h-11 rounded-xl bg-white px-3 text-xs font-bold text-amber-950">Retry</button>
            <a href="mailto:info@glass-railing.com?subject=RF%20Tools%20connection%20help" className="flex min-h-11 items-center justify-center rounded-xl border border-white/30 px-3 text-xs font-bold text-white">Support</a>
          </div>
        </div>
      )}
      {native && locked && <UnlockOverlay busy={unlockBusy} error={unlockError} onUnlock={() => void unlock()} />}
    </RuntimeContext.Provider>
  );
}
