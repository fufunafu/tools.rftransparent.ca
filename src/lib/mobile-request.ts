export function isMobileRequest(userAgent: string | null): boolean {
  if (!userAgent) return false;

  return /iPhone|iPod|iPad|Android.+Mobile|Mobile\/[A-Za-z0-9]+/i.test(
    userAgent,
  );
}
