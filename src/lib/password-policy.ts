export const MIN_PASSWORD_LENGTH = 12;

export function passwordStrengthProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > 72) return "Use no more than 72 bytes for your password.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return "Include an uppercase letter, a lowercase letter, a number, and a special character.";
  }
  return null;
}
