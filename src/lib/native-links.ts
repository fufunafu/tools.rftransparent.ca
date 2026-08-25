import { RF_TOOLS_ORIGIN, isLocalDevelopmentOrigin } from "@/lib/native-runtime";
import { nativeLinkAccessRequirement } from "@/lib/native-link-access";

const EXACT_DESTINATIONS = new Set([
  "/",
  "/clock",
  "/todos",
  "/more",
  "/warehouse/report",
  "/customer-service",
  "/customer-service/follow-up",
  "/customer-service/problems",
  "/sales",
  "/dashboards/marketing",
  "/employees",
  "/warehouse",
  "/support",
  "/privacy",
]);

export type NativeLinkResolution =
  | { kind: "destination"; href: string }
  | { kind: "expired"; href: "/?native_link=expired" }
  | { kind: "unsupported"; href: "/?native_link=unsupported" };

export type AuthorizedNativeLinkResolution =
  | NativeLinkResolution
  | { kind: "unauthenticated"; href: string }
  | { kind: "unauthorized"; href: "/?native_link=unauthorized" };

export function resolveNativeLink(
  value: string | URL,
  currentOrigin = RF_TOOLS_ORIGIN,
  now = Date.now(),
): NativeLinkResolution {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value, currentOrigin);
  } catch {
    return { kind: "unsupported", href: "/?native_link=unsupported" };
  }

  const origin = new URL(currentOrigin);
  const trustedProduction = url.protocol === "https:" && url.origin === RF_TOOLS_ORIGIN;
  const trustedLocal =
    isLocalDevelopmentOrigin(origin) && url.origin === origin.origin;
  if (!trustedProduction && !trustedLocal) {
    return { kind: "unsupported", href: "/?native_link=unsupported" };
  }

  if (!EXACT_DESTINATIONS.has(url.pathname)) {
    return { kind: "unsupported", href: "/?native_link=unsupported" };
  }

  const expiryValues = [
    ...url.searchParams.getAll("exp").map((expiry) => ({ expiry, unixSeconds: true })),
    ...url.searchParams.getAll("expires").map((expiry) => ({ expiry, unixSeconds: false })),
    ...url.searchParams.getAll("expires_at").map((expiry) => ({ expiry, unixSeconds: false })),
  ];
  if (expiryValues.length > 0) {
    const expiryTimes = expiryValues.map(({ expiry, unixSeconds }) => {
      if (unixSeconds || /^\d+$/.test(expiry)) return Number(expiry) * 1_000;
      return Date.parse(expiry);
    });
    if (
      expiryTimes.length !== 1 ||
      !Number.isFinite(expiryTimes[0]) ||
      expiryTimes[0] <= now
    ) {
      return { kind: "expired", href: "/?native_link=expired" };
    }
  }

  return {
    kind: "destination",
    href: `${url.pathname}${url.search}${url.hash}`,
  };
}

export async function resolveAuthorizedNativeLink(
  value: string | URL,
  currentOrigin = RF_TOOLS_ORIGIN,
): Promise<AuthorizedNativeLinkResolution> {
  const resolution = resolveNativeLink(value, currentOrigin);
  if (resolution.kind !== "destination") return resolution;

  const current = new URL(currentOrigin);
  const pathname = new URL(resolution.href, current).pathname;
  if (
    isLocalDevelopmentOrigin(current) ||
    nativeLinkAccessRequirement(pathname) === "public"
  ) {
    return resolution;
  }

  try {
    const response = await fetch(
      `/api/native/link?href=${encodeURIComponent(resolution.href)}`,
      { cache: "no-store" },
    );
    if (response.status === 401) {
      const params = new URLSearchParams({
        error: "session_expired",
        next: resolution.href,
      });
      return { kind: "unauthenticated", href: `/login?${params}` };
    }
    if (response.status === 403) {
      return { kind: "unauthorized", href: "/?native_link=unauthorized" };
    }
    if (!response.ok) {
      return { kind: "unsupported", href: "/?native_link=unsupported" };
    }

    const payload = await response.json() as { kind?: unknown; href?: unknown };
    if (payload.kind !== "destination" || typeof payload.href !== "string") {
      return { kind: "unsupported", href: "/?native_link=unsupported" };
    }
    const authorized = resolveNativeLink(payload.href, currentOrigin);
    return authorized.kind === "destination" && authorized.href === resolution.href
      ? authorized
      : { kind: "unsupported", href: "/?native_link=unsupported" };
  } catch {
    return { kind: "unsupported", href: "/?native_link=unsupported" };
  }
}
