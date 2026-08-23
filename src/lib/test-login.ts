const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function testLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_TEST_LOGIN === "1"
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function testLoginRequestAllowed(requestUrl: string): boolean {
  if (!testLoginEnabled()) return false;

  try {
    return isLoopbackHostname(new URL(requestUrl).hostname);
  } catch {
    return false;
  }
}
