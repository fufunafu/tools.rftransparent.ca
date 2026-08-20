"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { registerForPush } from "@/lib/app-push";
import { isNativeApp } from "@/lib/app-biometrics";

// The native flag never changes during a page's life; false on the server so
// SSR and hydration agree.
const NEVER_CHANGES = () => () => {};
const serverSaysNo = () => false;

// Renders nothing; asks for notification permission (once) and refreshes the
// device-token registration on every app launch. Mounted app-wide, but only
// acts inside the native shell on signed-in pages — prompting on the login
// screen would be rude and the register call would 401 anyway.
export default function PushRegistrar() {
  const isNative = useSyncExternalStore(NEVER_CHANGES, isNativeApp, serverSaysNo);
  const pathname = usePathname();
  const onAuthedPage = !pathname.startsWith("/login") && !pathname.startsWith("/survey");

  useEffect(() => {
    if (!isNative || !onAuthedPage) return;
    void registerForPush();
  }, [isNative, onAuthedPage]);

  return null;
}
