export const AMAZON_PASSWORD_DAYS = 365;
export const AMAZON_PASSWORD_MAX_AGE_MS = AMAZON_PASSWORD_DAYS * 24 * 60 * 60 * 1000;

export { passwordStrengthProblem as amazonPasswordProblem } from "@/lib/password-policy";

export function amazonPasswordCurrent(verifiedAt: unknown, now = Date.now()): boolean {
  if (typeof verifiedAt !== "string") return false;
  const age = now - Date.parse(verifiedAt);
  return Number.isFinite(age) && age >= 0 && age < AMAZON_PASSWORD_MAX_AGE_MS;
}

export function recentAmazonMfa(amr: unknown, now = Date.now()): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (!entry || typeof entry !== "object" || entry.method !== "totp" || typeof entry.timestamp !== "number") return false;
    const age = now - entry.timestamp * 1000;
    return age >= 0 && age < 5 * 60 * 1000;
  });
}
