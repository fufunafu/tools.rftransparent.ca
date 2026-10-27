const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9:_-]+$/;

export function normalizePushDeviceToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 32 || token.length > 200) return null;
  return DEVICE_TOKEN_PATTERN.test(token) ? token : null;
}
