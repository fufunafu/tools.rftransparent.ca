import { timingSafeEqual } from "node:crypto";

export const REVIEW_PROXY_HEADER = "x-rf-review-proxy";

export function isReviewUser(user: { id: string } | null): boolean {
  const id = process.env.RF_REVIEW_USER_ID?.trim();
  return Boolean(id && user?.id === id);
}

export function reviewWorkspaceTarget(source: URL): URL {
  const origin = new URL(process.env.RF_REVIEW_ORIGIN ?? "");
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".vercel.app") ||
    origin.username || origin.password || origin.port ||
    origin.pathname !== "/" || origin.search || origin.hash
  ) {
    throw new Error("The review workspace requires a trusted HTTPS deployment origin.");
  }
  origin.pathname = source.pathname;
  origin.search = source.search;
  return origin;
}

export function reviewProxySecret(): string {
  const secret = process.env.RF_REVIEW_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("Review workspace proxy authentication is not configured.");
  }
  return secret;
}

export function hasReviewProxyAccess(value: string | null): boolean {
  if (!value) return false;
  try {
    const expected = Buffer.from(reviewProxySecret());
    const received = Buffer.from(value);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export { demoDataConfiguration, isDemoWorkspace } from "./review-data-config";
