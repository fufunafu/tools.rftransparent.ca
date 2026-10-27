// Pure logic for the password-reset pages, kept out of the components so it
// can be unit-tested.

import { passwordStrengthProblem } from "./password-policy";
export { MIN_PASSWORD_LENGTH } from "./password-policy";

// Returns a human-readable problem with the chosen password, or null when
// it's acceptable. Supabase enforces its own policy server-side too; this
// only catches the mistakes people actually make before a round-trip.
export function passwordProblem(password: string, confirm: string): string | null {
  const problem = passwordStrengthProblem(password);
  if (problem) return problem;
  if (password !== confirm) {
    return "The two passwords don't match.";
  }
  return null;
}

export type RecoveryParams = {
  // From the customized Supabase email template — works in any browser.
  tokenHash: string | null;
  // From the default template's PKCE redirect — only works in the browser
  // that requested the reset, kept as a fallback.
  code: string | null;
};

export function recoveryParams(search: string): RecoveryParams {
  const params = new URLSearchParams(search);
  return {
    tokenHash: params.get("token_hash"),
    code: params.get("code"),
  };
}
