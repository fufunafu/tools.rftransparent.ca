"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { registerForPush, unregisterForPush } from "@/lib/app-push";
import { isNativeApp } from "@/lib/app-biometrics";

// The native flag never changes during a page's life; false on the server so
// SSR and hydration agree.
const NEVER_CHANGES = () => () => {};
const serverSaysNo = () => false;

// Pages a signed-out visitor can reach; prompting for notifications there
// would be rude and the register call would 401 anyway.
const SIGNED_OUT_PATHS = ["/login", "/survey", "/forgot-password", "/reset-password"];

// Renders nothing; asks for notification permission (once) and refreshes the
// device-token registration on every app launch. Mounted app-wide, but only
// acts inside the native shell on signed-in pages.
export default function PushRegistrar() {
  const isNative = useSyncExternalStore(NEVER_CHANGES, isNativeApp, serverSaysNo);
  const pathname = usePathname();
  const onAuthedPage = !SIGNED_OUT_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (!isNative || !onAuthedPage) return;
    void registerForPush();
  }, [isNative, onAuthedPage]);

  // Sign-out links are plain <a href="/api/logout"> scattered across the
  // sidebar and the More screen; intercepting them here keeps "stop notifying
  // this phone" in one place instead of in every layout.
  useEffect(() => {
    if (!isNative) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('a[href="/api/logout"]')) return;
      event.preventDefault();
      const signOut = () => {
        window.location.href = "/api/logout";
      };
      // A slow network must never trap someone on the way out.
      const patience = new Promise((resolve) => setTimeout(resolve, 2000));
      void Promise.race([unregisterForPush(), patience]).then(signOut, signOut);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isNative]);
  return null;
}
