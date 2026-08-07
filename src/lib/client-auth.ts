export function safeNextPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

export function sessionExpiredLoginUrl(nextPath: string): string {
  const params = new URLSearchParams({
    error: "session_expired",
    next: safeNextPath(nextPath),
  });
  return `/login?${params.toString()}`;
}

export function redirectOnUnauthorized(response: Response): Response {
  if (response.status !== 401 || typeof window === "undefined") return response;
  const nextPath = `${window.location.pathname}${window.location.search}`;
  window.location.assign(sessionExpiredLoginUrl(nextPath));
  return response;
}
