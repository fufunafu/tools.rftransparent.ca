export const RF_TOOLS_ORIGIN = "https://tools.rftransparent.ca";

export function isLocalDevelopmentOrigin(value: string | URL): boolean {
  const url = value instanceof URL ? value : new URL(value);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

export function isProtectedNativePath(pathname: string): boolean {
  return !(
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/privacy" ||
    pathname === "/support" ||
    pathname.startsWith("/print/") ||
    pathname.startsWith("/survey/") ||
    pathname.startsWith("/wall/")
  );
}

export function requiresNativeSessionUnlock(
  pathname: string,
  sessionUnlocked: boolean,
): boolean {
  return isProtectedNativePath(pathname) && !sessionUnlocked;
}

export function isTrustedAppUrl(value: string | URL, appOrigin: string): boolean {
  const url = value instanceof URL ? value : new URL(value, appOrigin);
  if (url.protocol === "https:" && url.origin === RF_TOOLS_ORIGIN) return true;

  // cap:sync:dev deliberately points the native shell at a local HTTP server.
  // Keep links on that exact origin in the WebView without broadening the
  // production navigation boundary.
  const currentOrigin = new URL(appOrigin);
  return isLocalDevelopmentOrigin(currentOrigin) && url.origin === currentOrigin.origin;
}
